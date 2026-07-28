/**
 * Products — list / CRUD handlers (etm_products). Migrado a server side
 * (issue #55): el cliente ya no toca Supabase directo.
 *   - auth en todas las rutas
 *   - list: shape paginado, búsqueda saneada, whitelist de orden
 *   - create: ETM obligatorio, 23505 → 400 descriptivo
 *   - update: is_sold TRI-ESTADO (null explícito se persiste), sin cambios → 400
 *   - delete: .eq('id')
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, findFilter, filterValue } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeRequest, makeParams } from '../helpers/request'
import * as listRoute from '@/app/api/products/route'
import * as itemRoute from '@/app/api/products/[id]/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const url = (qs = '') => ({ url: `http://localhost/api/products${qs}`, method: 'GET' })
const okList = { 'etm_products.select': { data: [{ id: '1' }], error: null, count: 1 } }

describe('GET /products (list)', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await listRoute.GET(makeRequest(undefined, url()))
    expect(res.status).toBe(401)
  })

  test('shape paginado + orden por etm asc por defecto', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: okList })
    const res = await listRoute.GET(makeRequest(undefined, url('?page=1&pageSize=20')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ count: 1, page: 1, pageSize: 20, totalPages: 1 })
    const rec = activeClient.callsTo('etm_products', 'select')[0]
    expect(findFilter(rec, 'etm', 'order')).toBeTruthy()
  })

  test('sortBy fuera de la whitelist cae a etm (no se interpola crudo)', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: okList })
    await listRoute.GET(makeRequest(undefined, url('?sortBy=price;drop')))
    const rec = activeClient.callsTo('etm_products', 'select')[0]
    expect(findFilter(rec, 'etm', 'order')).toBeTruthy()
  })

  test('sortBy válido + sortDir desc se respetan', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: okList })
    await listRoute.GET(makeRequest(undefined, url('?sortBy=price&sortDir=desc')))
    const rec = activeClient.callsTo('etm_products', 'select')[0]
    expect(findFilter(rec, 'price', 'order')).toBeTruthy()
  })

  test('búsqueda usa .or() y sanea los separadores del filtro', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: okList })
    await listRoute.GET(makeRequest(undefined, url('?search=' + encodeURIComponent('AB,C(x)%'))))
    const rec = activeClient.callsTo('etm_products', 'select')[0]
    const or = rec.filters.find((f) => f.method === 'or')
    expect(or).toBeTruthy()
    // Ni comas ni paréntesis del término llegan al filtro (romperían el .or()).
    const term = String(or!.args[0]).split('etm.ilike.%')[1]?.split('%')[0] ?? ''
    expect(term).not.toMatch(/[,()]/)
  })
})

describe('POST /products (create)', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await listRoute.POST(makeRequest({ etm: 'A' }, { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  test('400 si falta ETM', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await listRoute.POST(makeRequest({ etm: '   ' }, { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  test('crea con 201 y normaliza textos', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'etm_products.insert': { data: { id: '1' }, error: null } },
    })
    const res = await listRoute.POST(
      makeRequest({ etm: ' A-1 ', brand: ' urrea ', dymmsa_description: '  ' }, { method: 'POST' }),
    )
    expect(res.status).toBe(201)
    const payload = activeClient.callsTo('etm_products', 'insert')[0].payload as Record<string, unknown>
    expect(payload.etm).toBe('A-1')
    expect(payload.brand).toBe('urrea')
    expect(payload.dymmsa_description).toBeNull() // '' → null (única nullable)
  })

  test('ETM duplicado (23505) → 400 descriptivo, no 500', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'etm_products.insert': { data: null, error: { code: '23505', message: 'dup' } } },
    })
    const res = await listRoute.POST(makeRequest({ etm: 'A-1' }, { method: 'POST' }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toContain('A-1')
  })
})

describe('PATCH /products/[id] — is_sold tri-estado', () => {
  const patch = (body: unknown) =>
    itemRoute.PATCH(makeRequest(body, { method: 'PATCH' }), makeParams({ id: '1' }))

  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await patch({ is_sold: true })).status).toBe(401)
  })

  test.each([
    ['true', true],
    ['false', false],
    ['null (sin definir)', null],
  ])('persiste is_sold = %s', async (_label, value) => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'etm_products.update': { data: { id: '1' }, error: null } },
    })
    const res = await patch({ is_sold: value })
    expect(res.status).toBe(200)
    const rec = activeClient.callsTo('etm_products', 'update')[0]
    expect((rec.payload as Record<string, unknown>).is_sold).toBe(value)
    expect(filterValue(rec, 'id')).toBe('1')
  })

  test('is_sold ausente no toca la columna', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'etm_products.update': { data: { id: '1' }, error: null } },
    })
    await patch({ brand: 'URREA' })
    const payload = activeClient.callsTo('etm_products', 'update')[0].payload as Record<string, unknown>
    expect('is_sold' in payload).toBe(false)
  })

  test('is_sold con tipo inválido → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await patch({ is_sold: 'si' })).status).toBe(400)
  })

  test('body sin campos aplicables → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await patch({})).status).toBe(400)
  })

  test('ETM vacío → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await patch({ etm: '  ' })).status).toBe(400)
  })
})

describe('DELETE /products/[id]', () => {
  const del = () =>
    itemRoute.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: '1' }))

  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await del()).status).toBe(401)
  })

  test('elimina por id', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'etm_products.delete': { data: null, error: null } },
    })
    expect((await del()).status).toBe(200)
    expect(filterValue(activeClient.callsTo('etm_products', 'delete')[0], 'id')).toBe('1')
  })
})
