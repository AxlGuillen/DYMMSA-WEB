/**
 * URREA Catalog — list / stats / CRUD handlers (tabla aislada urrea_catalog).
 * Migrado a server side: el cliente ya no toca Supabase directo.
 *   - auth en todas las rutas
 *   - list: shape paginado, búsqueda (.or), whitelist de sortField
 *   - stats: count
 *   - create/update/delete: payload, .eq('id'), validación
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, findFilter, filterValue } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeRequest, makeParams } from '../helpers/request'
import * as listRoute from '@/app/api/urrea-catalog/route'
import * as statsRoute from '@/app/api/urrea-catalog/stats/route'
import * as itemRoute from '@/app/api/urrea-catalog/[id]/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const url = (qs = '') => ({ url: `http://localhost/api/urrea-catalog${qs}`, method: 'GET' })

describe('GET /urrea-catalog (list)', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await listRoute.GET(makeRequest(undefined, url()))
    expect(res.status).toBe(401)
  })

  test('devuelve shape paginado con count/totalPages', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.select': { data: [{ id: '1' }, { id: '2' }], error: null, count: 25 } },
    })
    const res = await listRoute.GET(makeRequest(undefined, url('?page=2&pageSize=10')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(25)
    expect(body.page).toBe(2)
    expect(body.totalPages).toBe(3)
    expect(body.data).toHaveLength(2)
    const rec = activeClient.callsTo('urrea_catalog', 'select')[0]
    expect(findFilter(rec, 'description', 'order')).toBeTruthy()
    expect(rec.filters.some((f) => f.method === 'range')).toBe(true)
  })

  test('búsqueda agrega filtro .or', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.select': { data: [], error: null, count: 0 } },
    })
    await listRoute.GET(makeRequest(undefined, url('?search=tornillo')))
    const rec = activeClient.callsTo('urrea_catalog', 'select')[0]
    const or = rec.filters.find((f) => f.method === 'or')
    expect(or).toBeTruthy()
    expect(String(or!.args[0])).toContain('tornillo')
  })

  test('filtro por marca agrega .eq(brand) normalizado', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.select': { data: [], error: null, count: 0 } },
    })
    await listRoute.GET(makeRequest(undefined, url('?brand=surtek')))
    const rec = activeClient.callsTo('urrea_catalog', 'select')[0]
    expect(filterValue(rec, 'brand')).toBe('SURTEK')
  })

  test('sortField inválido cae a description', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.select': { data: [], error: null, count: 0 } },
    })
    await listRoute.GET(makeRequest(undefined, url('?sortField=DROP&sortDir=desc')))
    const rec = activeClient.callsTo('urrea_catalog', 'select')[0]
    expect(findFilter(rec, 'description', 'order')).toBeTruthy()
    expect(findFilter(rec, 'DROP', 'order')).toBeUndefined()
  })

  test('sortField válido se respeta', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.select': { data: [], error: null, count: 0 } },
    })
    await listRoute.GET(makeRequest(undefined, url('?sortField=std')))
    const rec = activeClient.callsTo('urrea_catalog', 'select')[0]
    expect(findFilter(rec, 'std', 'order')).toBeTruthy()
  })
})

describe('GET /urrea-catalog/stats', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await statsRoute.GET()
    expect(res.status).toBe(401)
  })

  test('devuelve total y desglose por marca', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'urrea_catalog.select': { data: null, error: null, count: 42 },
        'rpc.urrea_catalog_brand_counts': {
          data: [{ brand: 'URREA', count: 30 }, { brand: 'SURTEK', count: 12 }],
          error: null,
        },
      },
    })
    const res = await statsRoute.GET()
    const body = await res.json()
    expect(body.total).toBe(42)
    expect(body.brands).toEqual([{ brand: 'URREA', count: 30 }, { brand: 'SURTEK', count: 12 }])
  })

  test('desglose por marca degrada a [] si la RPC falla', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'urrea_catalog.select': { data: null, error: null, count: 5 },
        'rpc.urrea_catalog_brand_counts': { data: null, error: { message: 'boom' } },
      },
    })
    const body = await (await statsRoute.GET()).json()
    expect(body.total).toBe(5)
    expect(body.brands).toEqual([])
  })
})

describe('POST /urrea-catalog (create)', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await listRoute.POST(makeRequest({ code: 'C1' }))
    expect(res.status).toBe(401)
  })

  test('400 si falta code', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await listRoute.POST(makeRequest({ description: 'x' }))
    expect(res.status).toBe(400)
  })

  test('crea con defaults (std=1, brand=URREA)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.insert': { data: { id: '1', code: 'C1' }, error: null } },
    })
    const res = await listRoute.POST(makeRequest({ code: '  C1  ', description: '  Tornillo  ' }))
    expect(res.status).toBe(201)
    const payload = activeClient.insertPayload<Record<string, unknown>>('urrea_catalog')
    expect(payload).toMatchObject({ code: 'C1', brand: 'URREA', description: 'Tornillo', std: 1 })
  })

  test('crea con marca explícita normalizada a mayúsculas', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.insert': { data: { id: '2', code: 'C2' }, error: null } },
    })
    const res = await listRoute.POST(makeRequest({ code: 'C2', brand: ' foy ' }))
    expect(res.status).toBe(201)
    expect(activeClient.insertPayload<Record<string, unknown>>('urrea_catalog').brand).toBe('FOY')
  })

  test('marca no-string → 400 (no 500 por reventar en .trim())', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await listRoute.POST(makeRequest({ code: 'C3', brand: 123 }))
    expect(res.status).toBe(400)
    expect(activeClient.didCall('urrea_catalog', 'insert')).toBe(false)
  })

  test('código duplicado → 400', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.insert': { data: null, error: { code: '23505' } } },
    })
    const res = await listRoute.POST(makeRequest({ code: 'C1' }))
    expect(res.status).toBe(400)
  })
})

describe('PATCH /urrea-catalog/[id]', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await itemRoute.PATCH(makeRequest({ std: 5 }, { method: 'PATCH' }), makeParams({ id: '1' }))
    expect(res.status).toBe(401)
  })

  test('400 sin cambios', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await itemRoute.PATCH(makeRequest({}, { method: 'PATCH' }), makeParams({ id: '1' }))
    expect(res.status).toBe(400)
  })

  test('actualiza por id', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.update': { data: { id: '1', std: 9 }, error: null } },
    })
    const res = await itemRoute.PATCH(makeRequest({ std: 9 }, { method: 'PATCH' }), makeParams({ id: '1' }))
    expect(res.status).toBe(200)
    const rec = activeClient.callsTo('urrea_catalog', 'update')[0]
    expect(filterValue(rec, 'id')).toBe('1')
    expect(activeClient.updatePayload('urrea_catalog')).toMatchObject({ std: 9 })
  })
})

describe('DELETE /urrea-catalog/[id]', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await itemRoute.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: '1' }))
    expect(res.status).toBe(401)
  })

  test('elimina por id', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.delete': { data: null, error: null } },
    })
    const res = await itemRoute.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: '1' }))
    expect(res.status).toBe(200)
    const rec = activeClient.callsTo('urrea_catalog', 'delete')[0]
    expect(filterValue(rec, 'id')).toBe('1')
  })
})
