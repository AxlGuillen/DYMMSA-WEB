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

  test('búsqueda usa .or() y sanea separadores y comodines', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: okList })
    await listRoute.GET(makeRequest(undefined, url('?search=' + encodeURIComponent('AB,C(x)%*'))))
    const rec = activeClient.callsTo('etm_products', 'select')[0]
    const or = rec.filters.find((f) => f.method === 'or')
    expect(or).toBeTruthy()
    // Neither .or() separators nor ilike wildcards (`%`, `*`) reach the filter.
    const term = String(or!.args[0]).split('etm.ilike.%')[1]?.split('%')[0] ?? ''
    expect(term).not.toMatch(/[,()*]/)
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
    expect(payload.dymmsa_description).toBeNull() // '' → null (the only nullable)
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

  test('REGLA: precio negativo → 400 y no inserta', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await listRoute.POST(makeRequest({ etm: 'A-1', price: -10 }, { method: 'POST' }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toContain('negativo')
    expect(activeClient.didCall('etm_products', 'insert')).toBe(false)
  })

  test('REGLA ADR-013: curada con descripción oficial para su (código, marca) → 400 y no inserta', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.select': { data: [{ code: 'MC1', brand: 'URREA', description: 'Oficial' }], error: null } },
    })
    const res = await listRoute.POST(
      makeRequest({ etm: 'A-1', model_code: 'mc1', brand: 'URREA', dymmsa_description: 'Oficial' }, { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    expect(activeClient.didCall('etm_products', 'insert')).toBe(false)
  })

  test('curada sin match en el catálogo → se guarda', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'urrea_catalog.select': { data: [], error: null },
        'etm_products.insert': { data: { id: '1' }, error: null },
      },
    })
    const res = await listRoute.POST(
      makeRequest({ etm: 'A-1', model_code: 'MC9', dymmsa_description: ' Punta 30 mm ' }, { method: 'POST' }),
    )
    expect(res.status).toBe(201)
    expect(activeClient.insertPayload<Record<string, unknown>>('etm_products').dymmsa_description).toBe('Punta 30 mm')
  })
})

describe('PATCH /products/[id] — precio y Descripción DYMMSA (#157)', () => {
  const patch = (body: unknown) =>
    itemRoute.PATCH(makeRequest(body, { method: 'PATCH' }), makeParams({ id: '1' }))
  const stored = { id: '1', etm: 'A-1', model_code: 'MC1', brand: 'URREA', dymmsa_description: 'Copia de la oficial' }
  const official = { data: [{ code: 'MC1', brand: 'URREA', description: 'Oficial' }], error: null }

  test('REGLA: precio negativo → 400 sin tocar la BD', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await patch({ price: -1 })).status).toBe(400)
    expect(activeClient._calls).toHaveLength(0)
  })

  test('REGLA ADR-013: una curada NUEVA con match de catálogo → 400 y no actualiza', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'etm_products.select': { data: stored, error: null }, 'urrea_catalog.select': official },
    })
    expect((await patch({ dymmsa_description: 'Otra curada', price: 10 })).status).toBe(400)
    expect(activeClient.didCall('etm_products', 'update')).toBe(false)
  })

  test('la curada reenviada sin cambios (ProductForm con match) no se reescribe; lo demás sí', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'etm_products.select': { data: stored, error: null },
        'etm_products.update': { data: { id: '1' }, error: null },
      },
    })
    expect((await patch({ dymmsa_description: 'Copia de la oficial', price: 10 })).status).toBe(200)
    const payload = activeClient.updatePayload('etm_products')
    expect(payload).not.toHaveProperty('dymmsa_description')
    expect(payload.price).toBe(10)
    expect(activeClient.didCall('urrea_catalog', 'select')).toBe(false)
  })

  test('el cruce usa el código y la marca NUEVOS cuando vienen en el mismo cambio', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'etm_products.select': { data: { ...stored, model_code: 'MC9', dymmsa_description: null }, error: null },
        'urrea_catalog.select': official,
      },
    })
    expect((await patch({ model_code: 'MC1', dymmsa_description: 'Mi texto' })).status).toBe(400)
  })

  test('catálogo ilegible → 500 sin actualizar', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'etm_products.select': { data: { ...stored, dymmsa_description: null }, error: null },
        'urrea_catalog.select': { data: null, error: { message: 'boom' } },
      },
    })
    expect((await patch({ dymmsa_description: 'Mi texto' })).status).toBe(500)
    expect(activeClient.didCall('etm_products', 'update')).toBe(false)
  })

  test('vaciar la curada no consulta nada y la guarda en null', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'etm_products.update': { data: { id: '1' }, error: null } },
    })
    expect((await patch({ dymmsa_description: '  ' })).status).toBe(200)
    expect(activeClient.updatePayload('etm_products').dymmsa_description).toBeNull()
    expect(activeClient.didCall('etm_products', 'select')).toBe(false)
  })

  test('producto inexistente → 404', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'etm_products.select': { data: null, error: null } } })
    expect((await patch({ dymmsa_description: 'Mi texto' })).status).toBe(404)
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
  const ID = '11111111-1111-4111-8111-111111111111'
  const del = (id = ID) =>
    itemRoute.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id }))

  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await del()).status).toBe(401)
  })

  test('elimina por id', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'etm_products.delete': { data: [{ id: ID }], error: null } },
    })
    expect((await del()).status).toBe(200)
    expect(filterValue(activeClient.callsTo('etm_products', 'delete')[0], 'id')).toBe(ID)
  })

  test('un id que no existe es 404, no un ok (#157)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'etm_products.delete': { data: [], error: null } },
    })
    expect((await del()).status).toBe(404)
  })

  test('un id mal formado es 404 sin tocar la BD (#157)', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await del('no-es-uuid')).status).toBe(404)
    expect(activeClient.callsTo('etm_products', 'delete')).toHaveLength(0)
  })
})
