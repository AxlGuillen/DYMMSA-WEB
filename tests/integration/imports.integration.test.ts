/**
 * Excel imports against local Supabase (ADR-021): the real `ON CONFLICT` is
 * exactly what the mock fakes, and a bad import corrupts all inventory at once.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeExcelRequest } from '../helpers/request'
import { authedClient } from './helpers/clients'
import { resetDb, sql, closePool, LOCAL } from './helpers/db'
import * as invImport from '@/app/api/inventory/import/route'
import * as catImport from '@/app/api/urrea-catalog/import/route'
import * as productsImport from '@/app/api/products/import/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

beforeAll(async () => { activeClient = await authedClient() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

describe('POST /inventory/import (integración local)', () => {
  test('upsert actualiza la cantidad y PRESERVA la gaveta si el archivo no la trae', async () => {
    // Fixture: 60001 quantity 5, location 'Gaveta S1'.
    const res = await invImport.POST(makeExcelRequest([{ MODEL_CODE: '60001', QUANTITY: 20 }], { mode: 'upsert' }))
    expect(res.status).toBe(200)

    const [row] = await sql<{ quantity: number; location: string | null }>(
      "SELECT quantity, location FROM store_inventory WHERE model_code = '60001'",
    )
    expect(row).toMatchObject({ quantity: 20, location: 'Gaveta S1' })
  })

  test('upsert inserta un producto nuevo con su ubicación (alias "ubicacion")', async () => {
    const res = await invImport.POST(
      makeExcelRequest([{ MODEL_CODE: '90000', QUANTITY: 3, ubicacion: 'Gaveta Nueva' }], { mode: 'upsert' }),
    )
    expect(res.status).toBe(200)
    const [row] = await sql<{ quantity: number; location: string | null }>(
      "SELECT quantity, location FROM store_inventory WHERE model_code = '90000'",
    )
    expect(row).toMatchObject({ quantity: 3, location: 'Gaveta Nueva' })
  })

  test('replace borra todo lo anterior y deja solo lo del archivo', async () => {
    const res = await invImport.POST(makeExcelRequest([{ MODEL_CODE: '77777', QUANTITY: 1 }], { mode: 'replace' }))
    expect(res.status).toBe(200)
    const rows = await sql<{ model_code: string }>('SELECT model_code FROM store_inventory')
    expect(rows).toEqual([{ model_code: '77777' }])
  })
})

describe('POST /urrea-catalog/import (integración local)', () => {
  test('columna "codigo" faltante → 400', async () => {
    const res = await catImport.POST(makeExcelRequest([{ foo: 'bar' }], { mode: 'upsert' }))
    expect(res.status).toBe(400)
  })

  test('upsert por (code,brand) normalizado actualiza la fila existente del catálogo', async () => {
    // Fixture 60001|URREA exists; lowercase input normalizes into a match.
    const res = await catImport.POST(
      makeExcelRequest([{ codigo: ' 60001 ', marca: 'urrea', descripcion: 'ACTUALIZADA', std: 8 }], { mode: 'upsert' }),
    )
    expect(res.status).toBe(200)
    const [row] = await sql<{ description: string; std: number }>(
      "SELECT description, std FROM urrea_catalog WHERE code = '60001' AND brand = 'URREA'",
    )
    expect(row).toMatchObject({ description: 'ACTUALIZADA', std: 8 })
  })
})

const catalogRows = () =>
  sql<{ code: string; brand: string; description: string | null; std: number }>(
    'SELECT code, brand, description, std FROM urrea_catalog ORDER BY brand, code',
  )

describe('replace del catálogo URREA en una transacción (#157, integración local)', () => {
  test('REGLA: replace con un (código, marca) repetido → 400 y el catálogo queda intacto', async () => {
    const before = await catalogRows()
    const res = await catImport.POST(
      makeExcelRequest([{ codigo: '70001', std: 2 }, { codigo: ' 70001 ', marca: 'urrea' }], { mode: 'replace' }),
    )
    expect(res.status).toBe(400)
    expect(await catalogRows()).toEqual(before)
  })

  test('REGLA: la función es todo o nada — si el insert truena, el delete se deshace', async () => {
    const before = await catalogRows()
    const { error } = await activeClient.rpc('replace_urrea_catalog', {
      p_rows: [
        { code: '70001', brand: 'URREA', description: null, std: 1 },
        { code: '70001', brand: 'URREA', description: 'otra vez', std: 1 },
      ],
    })
    expect(error?.code).toBe('23505')
    expect(await catalogRows()).toEqual(before)
  })

  test('una lista vacía o con un código vacío no vacía el catálogo', async () => {
    const before = await catalogRows()
    expect((await activeClient.rpc('replace_urrea_catalog', { p_rows: [] })).error?.message).toBe('empty_catalog')
    const blank = await activeClient.rpc('replace_urrea_catalog', { p_rows: [{ code: '  ', brand: 'URREA', std: 1 }] })
    expect(blank.error?.message).toBe('empty_code')
    expect(await catalogRows()).toEqual(before)
  })

  test('replace con un archivo bueno deja exactamente lo del archivo (normalizado)', async () => {
    const res = await catImport.POST(
      makeExcelRequest(
        [
          { codigo: ' 70001 ', descripcion: ' Llave nueva ', std: 12 },
          { codigo: '70001', marca: 'surtek' },
        ],
        { mode: 'replace' },
      ),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ imported: 2, mode: 'replace' })
    expect(await catalogRows()).toEqual([
      { code: '70001', brand: 'SURTEK', description: null, std: 1 },
      { code: '70001', brand: 'URREA', description: 'Llave nueva', std: 12 },
    ])
  })

  test('privilegios: INVOKER con search_path vacío; EXECUTE solo authenticated, nunca anon', async () => {
    const [fn] = await sql<{ prosecdef: boolean; proconfig: string[] | null; anon: boolean; authenticated: boolean }>(`
      SELECT p.prosecdef, p.proconfig,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
      FROM pg_proc p WHERE p.oid = 'public.replace_urrea_catalog(jsonb)'::regprocedure`)
    expect(fn).toMatchObject({ prosecdef: false, anon: false, authenticated: true })
    expect(fn.proconfig).toEqual(['search_path=""'])

    const before = await catalogRows()
    const anon = createClient(LOCAL.url, LOCAL.anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await anon.rpc('replace_urrea_catalog', { p_rows: [{ code: '70001', brand: 'URREA', std: 1 }] })
    expect(error).not.toBeNull()
    expect(await catalogRows()).toEqual(before)
  })
})

describe('POST /products/import con las reglas del auto-learn (#157, integración local)', () => {
  test('REGLA: upsert no pisa con vacíos; un ETM nuevo sin MODEL_CODE no recibe URREA', async () => {
    const res = await productsImport.POST(
      makeExcelRequest(
        [
          { ETM: 'SEED-URREA-1', MODEL_CODE: '', DESCRIPTION: '', DESCRIPTION_ES: 'Botador nuevo', PRICE: '', BRAND: '' },
          { ETM: 'NEW-NO-MODEL', MODEL_CODE: '', DESCRIPTION: 'Sin modelo' },
        ],
        { mode: 'upsert' },
      ),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ imported: 1, updated: 1 })

    const rows = await sql<Record<string, unknown>>(
      `SELECT etm, description, description_es, model_code, brand, price::float AS price, is_sold
       FROM etm_products WHERE etm IN ('SEED-URREA-1', 'NEW-NO-MODEL') ORDER BY etm`,
    )
    expect(rows).toEqual([
      { etm: 'NEW-NO-MODEL', description: 'Sin modelo', description_es: '', model_code: '', brand: null, price: 0, is_sold: null },
      {
        etm: 'SEED-URREA-1',
        description: 'Copper punch 30mm',
        description_es: 'Botador nuevo',
        model_code: '60001',
        brand: 'URREA',
        price: 100,
        is_sold: true,
      },
    ])
  })

  test('REGLA: un precio negativo → 400 y no escribe ninguna fila', async () => {
    const [{ count: before }] = await sql<{ count: string }>('SELECT count(*) FROM etm_products')
    const res = await productsImport.POST(
      makeExcelRequest([{ ETM: 'NEW-OK', MODEL_CODE: 'M1', PRICE: 5 }, { ETM: 'NEW-BAD', MODEL_CODE: 'M2', PRICE: -1 }]),
    )
    expect(res.status).toBe(400)
    const [{ count: after }] = await sql<{ count: string }>('SELECT count(*) FROM etm_products')
    expect(after).toBe(before)
  })
})
