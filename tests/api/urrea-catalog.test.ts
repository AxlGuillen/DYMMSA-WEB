/**
 * URREA Catalog — import handler (tabla aislada urrea_catalog).
 *   - validación de archivo/columnas
 *   - upsert por (code, brand) (onConflict)
 *   - replace (delete all + insert)
 *   - parseo de std (entero ≥ 1, default)
 *   - acepta encabezados en español (codigo/descripcion/marca)
 *   - marca: normalizada trim+upper; ausente → URREA
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeExcelRequest } from '../helpers/request'
import * as catalogImport from '@/app/api/urrea-catalog/import/route'
import * as catalogLookup from '@/app/api/urrea-catalog/lookup/route'
import { makeRequest } from '../helpers/request'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

describe('POST /urrea-catalog/import', () => {
  test('400 sin archivo', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await catalogImport.POST(makeExcelRequest([], { omitFile: true }))
    expect(res.status).toBe(400)
  })

  test('400 si el archivo no tiene datos', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await catalogImport.POST(makeExcelRequest([]))
    expect(res.status).toBe(400)
  })

  test('400 si falta la columna codigo', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await catalogImport.POST(makeExcelRequest([{ foo: 'bar', precio: 10 }]))
    expect(res.status).toBe(400)
  })

  test('upsert: llama upsert con encabezados en español; marca ausente → URREA', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.upsert': { data: null, error: null } },
    })
    const res = await catalogImport.POST(
      makeExcelRequest([{ codigo: 'C1', descripcion: 'Tornillo', std: 6 }]),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imported).toBe(1)
    expect(activeClient.didCall('urrea_catalog', 'upsert')).toBe(true)
    const payload = activeClient.upsertPayload<Record<string, unknown>[]>('urrea_catalog')
    expect(payload[0]).toMatchObject({ code: 'C1', brand: 'URREA', description: 'Tornillo', std: 6 })
  })

  test('marca: columna presente se normaliza a mayúsculas', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.upsert': { data: null, error: null } },
    })
    await catalogImport.POST(
      makeExcelRequest([{ codigo: 'C9', marca: '  surtek ', descripcion: 'X', std: 1 }]),
    )
    const payload = activeClient.upsertPayload<Record<string, unknown>[]>('urrea_catalog')
    expect(payload[0].brand).toBe('SURTEK')
  })

  test('std vacío/0 cae a 1', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.upsert': { data: null, error: null } },
    })
    await catalogImport.POST(makeExcelRequest([{ codigo: 'C2', descripcion: 'X' }]))
    const payload = activeClient.upsertPayload<Record<string, unknown>[]>('urrea_catalog')
    expect(payload[0].std).toBe(1)
  })

  test('modo replace: borra todo e inserta', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'urrea_catalog.delete': { data: null, error: null },
        'urrea_catalog.insert': { data: null, error: null },
      },
    })
    const res = await catalogImport.POST(
      makeExcelRequest([{ codigo: 'C1' }, { codigo: 'C2' }], { mode: 'replace' }),
    )
    const body = await res.json()
    expect(body.mode).toBe('replace')
    expect(body.imported).toBe(2)
    expect(activeClient.didCall('urrea_catalog', 'delete')).toBe(true)
    expect(activeClient.didCall('urrea_catalog', 'insert')).toBe(true)
  })
})

// ─── Normalización del code (llave de cruce Descripción DYMMSA) ──────────────

describe('POST /urrea-catalog/import — normalización de code', () => {
  test('REGLA: code se guarda normalizado (trim + mayúsculas)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.upsert': { data: null, error: null } },
    })
    const res = await catalogImport.POST(
      makeExcelRequest([{ codigo: '  mc-123 ', descripcion: 'Llave', std: 1 }]),
    )
    expect(res.status).toBe(200)
    const rows = activeClient.upsertPayload('urrea_catalog')
    expect(rows[0].code).toBe('MC-123')
  })
})

// ─── POST /urrea-catalog/lookup ───────────────────────────────────────────────

describe('POST /urrea-catalog/lookup', () => {
  test('400 si codes no es arreglo o está vacío', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await catalogLookup.POST(makeRequest({ codes: 'x' }))).status).toBe(400)
    expect((await catalogLookup.POST(makeRequest({ codes: [] }))).status).toBe(400)
  })

  test('devuelve mapa catalogKey(MARCA|CODIGO)→descripción; omite sin descripción', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'urrea_catalog.select': {
          data: [
            { code: 'MC1', brand: 'URREA', description: 'Oficial 1' },
            { code: 'MC1', brand: 'SURTEK', description: 'Oficial 1 (Surtek)' },
            { code: 'MC2', brand: 'URREA', description: null },
          ],
          error: null,
        },
      },
    })
    const res = await catalogLookup.POST(makeRequest({ codes: [' mc1 ', 'mc2', ''] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    // El mismo código en 2 marcas convive: cada uno con su llave.
    expect(body.descriptions).toEqual({
      'URREA|MC1': 'Oficial 1',
      'SURTEK|MC1': 'Oficial 1 (Surtek)',
    })
    // la query usó los codes normalizados y sin vacíos
    const call = activeClient.callsTo('urrea_catalog', 'select')[0]
    const inFilter = call.filters.find((f) => f.method === 'in')
    expect(inFilter?.args[1]).toEqual(['MC1', 'MC2'])
  })
})
