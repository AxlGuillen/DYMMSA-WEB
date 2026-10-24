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

  test('std vacío cae a 1', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.upsert': { data: null, error: null } },
    })
    await catalogImport.POST(makeExcelRequest([{ codigo: 'C2', descripcion: 'X' }]))
    const payload = activeClient.upsertPayload<Record<string, unknown>[]>('urrea_catalog')
    expect(payload[0].std).toBe(1)
  })

  test('REGLA: modo replace va en UNA llamada transaccional (replace_urrea_catalog), sin delete suelto', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'rpc.replace_urrea_catalog': { data: 2, error: null } },
    })
    const res = await catalogImport.POST(
      makeExcelRequest([{ codigo: 'c1' }, { codigo: 'C2', marca: 'surtek', std: 6 }], { mode: 'replace' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ mode: 'replace', imported: 2, errors: 0 })
    expect(activeClient._rpcCalls).toEqual([
      {
        fn: 'replace_urrea_catalog',
        params: {
          p_rows: [
            { code: 'C1', brand: 'URREA', description: null, std: 1 },
            { code: 'C2', brand: 'SURTEK', description: null, std: 6 },
          ],
        },
      },
    ])
    expect(activeClient.didCall('urrea_catalog', 'delete')).toBe(false)
    expect(activeClient.didCall('urrea_catalog', 'insert')).toBe(false)
  })

  test('replace que falla en la BD → 500 y avisa que el catálogo quedó como estaba', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'rpc.replace_urrea_catalog': { data: null, error: { code: '57014', message: 'timeout' } } },
    })
    const res = await catalogImport.POST(makeExcelRequest([{ codigo: 'C1' }], { mode: 'replace' }))
    expect(res.status).toBe(500)
    expect((await res.json()).message).toContain('quedó como estaba')
  })
})

describe('POST /urrea-catalog/import — el archivo se valida completo antes de escribir (#157)', () => {
  const badFiles: [string, Record<string, unknown>[], string][] = [
    ['un (código, marca) repetido', [{ codigo: 'C1', marca: 'URREA' }, { codigo: ' c1 ' }], 'Filas 2, 3'],
    ['un código vacío', [{ codigo: 'C1' }, { descripcion: 'sin código' }], 'Fila 3: falta el código'],
    ['un STD decimal', [{ codigo: 'C1', std: 2.5 }], 'Fila 2: el STD «2.5»'],
    ['un STD en cero', [{ codigo: 'C1', std: 0 }], 'Fila 2: el STD «0»'],
  ]

  test.each(badFiles)('replace con %s → 400 que nombra la fila y NO toca el catálogo', async (_label, rows, expected) => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await catalogImport.POST(makeExcelRequest(rows, { mode: 'replace' }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toContain(expected)
    expect(activeClient._rpcCalls).toHaveLength(0)
    expect(activeClient._calls).toHaveLength(0)
  })

  test.each(badFiles)('upsert con %s → 400 y no escribe', async (_label, rows) => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await catalogImport.POST(makeExcelRequest(rows))
    expect(res.status).toBe(400)
    expect(activeClient.didCall('urrea_catalog', 'upsert')).toBe(false)
  })
})

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
    // The same code lives under 2 brands: each with its own key.
    expect(body.descriptions).toEqual({
      'URREA|MC1': 'Oficial 1',
      'SURTEK|MC1': 'Oficial 1 (Surtek)',
    })
    // the query used the normalized codes, with no blanks
    const call = activeClient.callsTo('urrea_catalog', 'select')[0]
    const inFilter = call.filters.find((f) => f.method === 'in')
    expect(inFilter?.args[1]).toEqual(['MC1', 'MC2'])
  })
})
