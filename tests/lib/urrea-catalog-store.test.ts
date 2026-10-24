import { describe, test, expect } from 'vitest'
import {
  CatalogError,
  createCatalogItem,
  importCatalog,
  parseCatalogItemInput,
  parseCatalogSheet,
  toStd,
} from '@/lib/urrea-catalog-store'
import { createMockSupabase } from '../helpers/supabase-mock'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MockSupabaseClient } from '../helpers/supabase-mock'

const asDb = (mock: MockSupabaseClient) => mock as unknown as SupabaseClient

/** Runs `fn` and returns the CatalogError it threw (fails if it did not throw one). */
function catalogError(fn: () => unknown): CatalogError {
  try {
    fn()
  } catch (error) {
    if (error instanceof CatalogError) return error
    throw error
  }
  throw new Error('no lanzó CatalogError')
}

async function rejection(promise: Promise<unknown>): Promise<CatalogError> {
  const error = await promise.then(() => null, (e: unknown) => e)
  if (error instanceof CatalogError) return error
  throw new Error(`no rechazó con CatalogError: ${String(error)}`)
}

/** A sheet row as SheetJS returns it: the sheet row index lives in a non-enumerable __rowNum__. */
function sheetRow(rowIndex: number, cells: Record<string, unknown>): Record<string, unknown> {
  const row = { ...cells }
  Object.defineProperty(row, '__rowNum__', { value: rowIndex, enumerable: false })
  return row
}

describe('toStd', () => {
  test.each([
    [6, 6],
    ['12', 12],
    [' 3 ', 3],
  ])('%j es un STD válido', (input, expected) => {
    expect(toStd(input)).toBe(expected)
  })

  test.each([[2.5], ['2.5'], [0], [-1], ['abc'], [''], [null], [3e9], [true]])('%j no es un STD válido', (input) => {
    expect(toStd(input)).toBeNull()
  })
})

describe('parseCatalogItemInput', () => {
  test('alta: normaliza código y marca; STD vacío → 1; descripción en blanco → null', () => {
    expect(parseCatalogItemInput({ code: ' mc-1 ', brand: ' surtek ', description: '   ' }, { create: true })).toEqual({
      code: 'MC-1',
      brand: 'SURTEK',
      description: null,
      std: 1,
    })
  })

  test('alta sin marca → URREA', () => {
    expect(parseCatalogItemInput({ code: 'C1' }, { create: true }).brand).toBe('URREA')
  })

  test.each([[2.5], [0], [-4], ['diez']])('REGLA: STD %j → 400, no llega a la BD', (std) => {
    const error = catalogError(() => parseCatalogItemInput({ code: 'C1', std }, { create: true }))
    expect(error.status).toBe(400)
    expect(error.message).toMatch(/STD/)
  })

  test('alta sin código → 400', () => {
    expect(catalogError(() => parseCatalogItemInput({ std: 2 }, { create: true })).status).toBe(400)
  })

  test.each([
    ['code', 123],
    ['brand', 7],
    ['description', { x: 1 }],
  ])('%s que no es texto → 400 (no 500 por reventar en .trim())', (field, value) => {
    expect(catalogError(() => parseCatalogItemInput({ code: 'C1', [field]: value }, { create: true })).status).toBe(400)
  })

  test('edición: solo lo que viene; STD decimal o null → 400', () => {
    expect(parseCatalogItemInput({ std: 12 }, { create: false })).toEqual({ std: 12 })
    expect(catalogError(() => parseCatalogItemInput({ std: 2.5 }, { create: false })).status).toBe(400)
    expect(catalogError(() => parseCatalogItemInput({ std: null }, { create: false })).status).toBe(400)
  })

  test('edición sin cambios o con código vacío → 400', () => {
    expect(catalogError(() => parseCatalogItemInput({}, { create: false })).message).toBe('No hay cambios para aplicar')
    expect(catalogError(() => parseCatalogItemInput({ code: '  ' }, { create: false })).status).toBe(400)
  })
})

describe('parseCatalogSheet', () => {
  test('normaliza código y marca; STD vacío → 1; descripción recortada', () => {
    expect(parseCatalogSheet([{ codigo: ' ab-1 ', marca: ' foy ', descripcion: '  Llave  ' }, { code: 6954, std: '12' }])).toEqual({
      rows: [
        { code: 'AB-1', brand: 'FOY', description: 'Llave', std: 1 },
        { code: '6954', brand: 'URREA', description: null, std: 12 },
      ],
      columns: { description: true, std: true },
    })
  })

  test('encabezados con espacios o mayúsculas cuentan ("Codigo ", " STD")', () => {
    expect(parseCatalogSheet([{ 'Codigo ': 'C1', ' STD': 4 }]).rows).toEqual([
      { code: 'C1', brand: 'URREA', description: null, std: 4 },
    ])
  })

  test('REGLA: reporta qué columnas trae el archivo (un upsert no toca las que faltan)', () => {
    expect(parseCatalogSheet([{ codigo: 'C1', descripcion: 'x' }]).columns).toEqual({ description: true, std: false })
    expect(parseCatalogSheet([{ codigo: 'C1', std: 2 }]).columns).toEqual({ description: false, std: true })
  })

  test('sin columna de código → 400', () => {
    expect(catalogError(() => parseCatalogSheet([{ descripcion: 'x' }])).message).toMatch(/Columna faltante/)
  })

  test('sin filas → 400', () => {
    expect(catalogError(() => parseCatalogSheet([])).status).toBe(400)
  })

  test('REGLA: un (código, marca) repetido tras normalizar → 400 que nombra las dos filas', () => {
    const error = catalogError(() =>
      parseCatalogSheet([sheetRow(1, { codigo: 'C1', marca: 'URREA' }), sheetRow(2, { codigo: 'X' }), sheetRow(3, { codigo: ' c1 ' })]),
    )
    expect(error.status).toBe(400)
    expect(error.message).toContain('Filas 2, 4')
    expect(error.message).toContain('C1 de URREA')
  })

  test('el mismo código en dos marcas NO es repetido (identidad = código + marca)', () => {
    expect(parseCatalogSheet([{ codigo: 'C1', marca: 'URREA' }, { codigo: 'C1', marca: 'SURTEK' }]).rows).toHaveLength(2)
  })

  test('REGLA: código vacío y STD inválido → 400 con su número de fila (aunque SheetJS salte filas en blanco)', () => {
    const error = catalogError(() =>
      parseCatalogSheet([
        sheetRow(1, { codigo: 'OK', std: 2 }),
        sheetRow(5, { descripcion: 'sin código' }),
        sheetRow(6, { codigo: 'C2', std: 2.5 }),
        sheetRow(7, { codigo: 'C3', std: 0 }),
      ]),
    )
    expect(error.message).toContain('Fila 6: falta el código.')
    expect(error.message).toContain('Fila 7: el STD «2.5»')
    expect(error.message).toContain('Fila 8: el STD «0»')
  })

  test('muchos problemas: lista los primeros y cuántos más', () => {
    const rows = Array.from({ length: 12 }, () => ({ codigo: '', descripcion: 'x' }))
    const error = catalogError(() => parseCatalogSheet([{ codigo: 'OK' }, ...rows]))
    expect(error.message).toContain('…y 4 más.')
  })
})

describe('importCatalog', () => {
  const rows = [
    { code: 'C1', brand: 'URREA', description: 'Uno', std: 1 },
    { code: 'C2', brand: 'SURTEK', description: null, std: 6 },
  ]
  const full = { rows, columns: { description: true, std: true } }

  test('REGLA: replace va en UNA llamada a replace_urrea_catalog, nunca delete + insert sueltos', async () => {
    const mock = createMockSupabase({ responses: { 'rpc.replace_urrea_catalog': { data: 2, error: null } } })
    expect(await importCatalog(asDb(mock), full, 'replace')).toEqual({ imported: 2 })
    expect(mock._rpcCalls).toEqual([{ fn: 'replace_urrea_catalog', params: { p_rows: rows } }])
    expect(mock.didCall('urrea_catalog', 'delete')).toBe(false)
    expect(mock.didCall('urrea_catalog', 'insert')).toBe(false)
  })

  test('replace es el catálogo completo: aunque falten columnas, manda los defaults', async () => {
    const mock = createMockSupabase({ responses: { 'rpc.replace_urrea_catalog': { data: 2, error: null } } })
    await importCatalog(asDb(mock), { rows, columns: { description: false, std: false } }, 'replace')
    expect(mock._rpcCalls[0].params).toEqual({ p_rows: rows })
  })

  test('replace que falla en la BD → 500 que dice que el catálogo quedó como estaba', async () => {
    const mock = createMockSupabase({
      responses: { 'rpc.replace_urrea_catalog': { data: null, error: { code: '57014', message: 'canceling statement' } } },
    })
    const error = await rejection(importCatalog(asDb(mock), full, 'replace'))
    expect(error.status).toBe(500)
    expect(error.message).toContain('quedó como estaba')
  })

  test.each([
    [{ code: 'P0001', message: 'empty_catalog' }],
    [{ code: 'P0001', message: 'empty_code' }],
    [{ code: '23505', message: 'duplicate key value violates unique constraint "urrea_catalog_code_brand_key"' }],
    [{ code: '23514', message: 'urrea_catalog_std_check' }],
  ])('replace rechazado por una regla de la BD (%j) → 400', async (dbError) => {
    const mock = createMockSupabase({ responses: { 'rpc.replace_urrea_catalog': { data: null, error: dbError } } })
    expect((await rejection(importCatalog(asDb(mock), full, 'replace'))).status).toBe(400)
  })

  test('upsert por (code, brand) en una sola sentencia', async () => {
    const mock = createMockSupabase({ responses: { 'urrea_catalog.upsert': { data: null, error: null } } })
    expect(await importCatalog(asDb(mock), full, 'upsert')).toEqual({ imported: 2 })
    const [call] = mock.callsTo('urrea_catalog', 'upsert')
    expect(call.options).toEqual({ onConflict: 'code,brand' })
    expect(call.payload).toEqual(rows)
    expect(mock._rpcCalls).toHaveLength(0)
  })

  test('REGLA ADR-018: un upsert sin columna std ni descripcion NO las manda (no pisa el STD guardado con 1)', async () => {
    const mock = createMockSupabase({ responses: { 'urrea_catalog.upsert': { data: null, error: null } } })
    await importCatalog(asDb(mock), { rows, columns: { description: false, std: false } }, 'upsert')
    expect(mock.upsertPayload('urrea_catalog')).toEqual([
      { code: 'C1', brand: 'URREA' },
      { code: 'C2', brand: 'SURTEK' },
    ])
  })

  test('upsert con std pero sin descripcion: solo omite la descripción', async () => {
    const mock = createMockSupabase({ responses: { 'urrea_catalog.upsert': { data: null, error: null } } })
    await importCatalog(asDb(mock), { rows, columns: { description: false, std: true } }, 'upsert')
    expect(mock.upsertPayload('urrea_catalog')[1]).toEqual({ code: 'C2', brand: 'SURTEK', std: 6 })
  })

  test('upsert que falla → 500', async () => {
    const mock = createMockSupabase({ responses: { 'urrea_catalog.upsert': { data: null, error: { code: 'XX000' } } } })
    expect((await rejection(importCatalog(asDb(mock), full, 'upsert'))).status).toBe(500)
  })

  test('sin filas no escribe nada', async () => {
    const mock = createMockSupabase()
    expect((await rejection(importCatalog(asDb(mock), { ...full, rows: [] }, 'replace'))).status).toBe(400)
    expect(mock._rpcCalls).toHaveLength(0)
  })
})

describe('createCatalogItem', () => {
  test.each([
    [{ code: '  ', brand: 'URREA', description: null, std: 1 }],
    [{ code: 'C1', brand: 'URREA', description: null, std: 0 }],
    [{ code: 'C1', brand: 'URREA', description: null, std: 2.5 }],
  ])('REGLA: aunque el llamador se salte el parser, no inserta un código vacío ni un STD inválido (%j)', async (item) => {
    const mock = createMockSupabase()
    expect((await rejection(createCatalogItem(asDb(mock), item))).status).toBe(400)
    expect(mock.didCall('urrea_catalog', 'insert')).toBe(false)
  })

  test('inserta normalizado', async () => {
    const mock = createMockSupabase({ responses: { 'urrea_catalog.insert': { data: { id: '1' }, error: null } } })
    await createCatalogItem(asDb(mock), { code: ' c1 ', brand: ' foy ', description: '  ', std: 3 })
    expect(mock.insertPayload('urrea_catalog')).toEqual({ code: 'C1', brand: 'FOY', description: null, std: 3 })
  })
})
