import { describe, test, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assertCuratedAllowed,
  importProducts,
  parseProductInput,
  parseProductSheet,
  priceIssue,
  ProductError,
  type ProductImportRow,
} from '@/lib/products-store'
import { createMockSupabase, type MockSupabaseClient } from '../helpers/supabase-mock'

const asDb = (mock: MockSupabaseClient) => mock as unknown as SupabaseClient

function productError(fn: () => unknown): ProductError {
  try {
    fn()
  } catch (error) {
    if (error instanceof ProductError) return error
    throw error
  }
  throw new Error('no lanzó ProductError')
}

async function rejection(promise: Promise<unknown>): Promise<ProductError> {
  const error = await promise.then(() => null, (e: unknown) => e)
  if (error instanceof ProductError) return error
  throw new Error(`no rechazó con ProductError: ${String(error)}`)
}

const OFFICIAL = { data: [{ code: 'MC1', brand: 'URREA', description: 'Oficial URREA' }], error: null }

describe('priceIssue', () => {
  test('0 y precios positivos son válidos', () => {
    expect(priceIssue(0)).toBeNull()
    expect(priceIssue(245.5)).toBeNull()
  })

  test.each([
    [-0.01, 'negativo'],
    [Number.NaN, 'número'],
    [Number.POSITIVE_INFINITY, 'número'],
    [100_000_000, 'demasiado grande'],
  ])('%d → %s', (price, word) => {
    expect(priceIssue(price)).toContain(word)
  })
})

describe('parseProductInput', () => {
  test('alta: recorta textos y pone defaults (precio 0, is_sold sin definir, curada null)', () => {
    expect(parseProductInput({ etm: ' E-1 ', brand: ' urrea ', dymmsa_description: '  ' }, { create: true })).toEqual({
      etm: 'E-1',
      description: '',
      description_es: '',
      model_code: '',
      brand: 'urrea',
      dymmsa_description: null,
      price: 0,
      is_sold: null,
    })
  })

  test.each([[-5], ['100'], [Number.NaN]])('REGLA: precio %j → 400', (price) => {
    expect(productError(() => parseProductInput({ etm: 'E1', price }, { create: true })).status).toBe(400)
    expect(productError(() => parseProductInput({ price }, { create: false })).status).toBe(400)
  })

  test('is_sold tri-estado: null explícito se conserva en la edición; otro tipo → 400', () => {
    expect(parseProductInput({ is_sold: null }, { create: false })).toEqual({ is_sold: null })
    expect(parseProductInput({ is_sold: false }, { create: false })).toEqual({ is_sold: false })
    expect(productError(() => parseProductInput({ is_sold: 'si' }, { create: false })).status).toBe(400)
  })

  test('un texto que no es texto → 400 (antes se guardaba vacío sin avisar)', () => {
    expect(productError(() => parseProductInput({ etm: 'E1', model_code: 6954 }, { create: true })).status).toBe(400)
  })

  test('edición vacía o ETM vacío → 400', () => {
    expect(productError(() => parseProductInput({}, { create: false })).message).toBe('No hay cambios para aplicar')
    expect(productError(() => parseProductInput({ etm: '  ' }, { create: false })).status).toBe(400)
    expect(productError(() => parseProductInput({ etm: '' }, { create: true })).status).toBe(400)
  })
})

describe('assertCuratedAllowed (ADR-013 en el servidor)', () => {
  test('REGLA: con descripción oficial para su (código, marca) → 400', async () => {
    const mock = createMockSupabase({ responses: { 'urrea_catalog.select': OFFICIAL } })
    const error = await rejection(assertCuratedAllowed(asDb(mock), { model_code: ' mc1 ', brand: '' }, 'Mi texto'))
    expect(error.status).toBe(400)
    expect(error.message).toContain('MC1 de URREA')
  })

  test('el código existe solo bajo otra marca → la curada sí se guarda (cruce estricto)', async () => {
    const mock = createMockSupabase({
      responses: { 'urrea_catalog.select': { data: [{ code: 'MC1', brand: 'SURTEK', description: 'Oficial SURTEK' }], error: null } },
    })
    await expect(assertCuratedAllowed(asDb(mock), { model_code: 'MC1', brand: 'URREA' }, 'Mi texto')).resolves.toBeUndefined()
  })

  test('catálogo ilegible con código → 500 (no se toma por "sin match")', async () => {
    const mock = createMockSupabase({ responses: { 'urrea_catalog.select': { data: null, error: { message: 'boom' } } } })
    expect((await rejection(assertCuratedAllowed(asDb(mock), { model_code: 'MC1', brand: 'URREA' }, 'x'))).status).toBe(500)
  })

  test('sin código de modelo no consulta el catálogo', async () => {
    const mock = createMockSupabase()
    await expect(assertCuratedAllowed(asDb(mock), { model_code: '', brand: '' }, 'x')).resolves.toBeUndefined()
    expect(mock.didCall('urrea_catalog', 'select')).toBe(false)
  })
})

describe('parseProductSheet', () => {
  test('columnas obligatorias ETM y MODEL_CODE (aunque la primera fila traiga la celda vacía)', () => {
    expect(productError(() => parseProductSheet([{ ETM: 'E1' }])).message).toBe('Columnas faltantes: MODEL_CODE')
    expect(parseProductSheet([{ ETM: 'E1' }, { ETM: 'E2', MODEL_CODE: 'MC2' }]).rows).toHaveLength(2)
  })

  test('precio vacío → null (no pisa); filas sin ETM se cuentan aparte', () => {
    const { rows, withoutEtm } = parseProductSheet([{ ETM: 'E1', MODEL_CODE: 'MC1', PRICE: '' }, { MODEL_CODE: 'MC9' }])
    expect(rows).toEqual([{ etm: 'E1', description: '', description_es: '', model_code: 'MC1', brand: '', price: null }])
    expect(withoutEtm).toBe(1)
  })

  test('REGLA: un precio negativo o que no es número → 400 que nombra la fila; no regresa filas', () => {
    const error = productError(() =>
      parseProductSheet([
        { ETM: 'E1', MODEL_CODE: 'MC1', PRICE: 10 },
        { ETM: 'E2', MODEL_CODE: 'MC2', PRICE: -5 },
        { ETM: 'E3', MODEL_CODE: 'MC3', PRICE: '$1,200' },
      ]),
    )
    expect(error.status).toBe(400)
    expect(error.message).toContain('Fila 3 (ETM E2): el precio no puede ser negativo')
    expect(error.message).toContain('Fila 4 (ETM E3): el precio debe ser un número')
  })
})

const row = (overrides: Partial<ProductImportRow> = {}): ProductImportRow => ({
  etm: 'E1',
  description: '',
  description_es: '',
  model_code: '',
  brand: '',
  price: null,
  ...overrides,
})

const EXISTING = {
  etm: 'E1',
  description: 'Existing',
  description_es: 'Existente',
  dymmsa_description: 'Curada',
  model_code: 'MC1',
  price: 80,
  brand: 'TRUPER',
  is_sold: false,
}

describe('importProducts (reglas del auto-learn)', () => {
  test('REGLA: ETM nuevo sin MODEL_CODE no recibe marca URREA', async () => {
    const mock = createMockSupabase({ responses: { 'etm_products.select': { data: [], error: null } } })
    const result = await importProducts(asDb(mock), 'user-1', [row()], 'upsert')
    expect(result.imported).toBe(1)
    const payload = mock.insertPayload<Record<string, unknown>>('etm_products')
    expect(payload.brand).toBeNull()
    expect(payload.created_by).toBe('user-1')
  })

  test('ETM nuevo con MODEL_CODE y sin marca → URREA; sin precio → 0; nunca curada ni is_sold', async () => {
    const mock = createMockSupabase({ responses: { 'etm_products.select': { data: [], error: null } } })
    await importProducts(asDb(mock), 'user-1', [row({ model_code: 'MC1' })], 'upsert')
    expect(mock.insertPayload<Record<string, unknown>>('etm_products')).toMatchObject({
      brand: 'URREA',
      price: 0,
      dymmsa_description: null,
      is_sold: null,
    })
  })

  test('REGLA: upsert sobre un existente solo escribe las celdas con valor que cambian', async () => {
    const mock = createMockSupabase({ responses: { 'etm_products.select': { data: [EXISTING], error: null } } })
    const result = await importProducts(asDb(mock), 'user-2', [row({ description_es: 'Nueva', price: 95 })], 'upsert')
    expect(result).toEqual({ imported: 0, updated: 1, skipped: 0, errors: 0 })
    const update = mock.updatePayload('etm_products')
    expect(update).toMatchObject({ description_es: 'Nueva', price: 95 })
    // Blank cells, the curated text, is_sold and created_by are never written.
    for (const key of ['description', 'model_code', 'brand', 'dymmsa_description', 'is_sold', 'created_by']) {
      expect(update).not.toHaveProperty(key)
    }
  })

  test('sin nada nuevo no escribe (sin cambios)', async () => {
    const mock = createMockSupabase({ responses: { 'etm_products.select': { data: [EXISTING], error: null } } })
    const result = await importProducts(asDb(mock), 'u', [row({ model_code: 'MC1', price: 80 })], 'upsert')
    expect(result.skipped).toBe(1)
    expect(mock.didCall('etm_products', 'update')).toBe(false)
  })

  test('"Solo agregar nuevos" no toca un ETM existente', async () => {
    const mock = createMockSupabase({ responses: { 'etm_products.select': { data: [EXISTING], error: null } } })
    const result = await importProducts(asDb(mock), 'u', [row({ description: 'Otra' })], 'insert')
    expect(result.skipped).toBe(1)
    expect(mock.didCall('etm_products', 'update')).toBe(false)
    expect(mock.didCall('etm_products', 'insert')).toBe(false)
  })

  test('un ETM repetido en el archivo: la segunda fila se mezcla con la primera', async () => {
    const mock = createMockSupabase({ responses: { 'etm_products.select': { data: [], error: null } } })
    const result = await importProducts(
      asDb(mock),
      'u',
      [row({ model_code: 'MC1', description: 'Uno' }), row({ description_es: 'Dos' })],
      'upsert',
    )
    expect(result).toMatchObject({ imported: 1, updated: 1 })
    expect(mock.updatePayload('etm_products')).toMatchObject({ description_es: 'Dos' })
  })

  test('si no puede leer los existentes → 500 sin escribir nada', async () => {
    const mock = createMockSupabase({ responses: { 'etm_products.select': { data: null, error: { message: 'boom' } } } })
    expect((await rejection(importProducts(asDb(mock), 'u', [row()], 'upsert'))).status).toBe(500)
    expect(mock.didCall('etm_products', 'insert')).toBe(false)
  })

  test('una escritura que falla cuenta como error y sigue con las demás', async () => {
    const mock = createMockSupabase({
      responses: {
        'etm_products.select': { data: [], error: null },
        'etm_products.insert': (rec) =>
          (rec.payload as { etm: string }).etm === 'E1' ? { data: null, error: { code: '23505' } } : { data: null, error: null },
      },
    })
    const result = await importProducts(asDb(mock), 'u', [row(), row({ etm: 'E2' })], 'upsert')
    expect(result).toMatchObject({ imported: 1, errors: 1 })
  })
})
