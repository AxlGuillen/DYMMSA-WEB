/**
 * Inventory — list / stats / CRUD handlers (store_inventory).
 * Migrado a server side: el cliente ya no toca Supabase directo.
 *   - auth en todas las rutas
 *   - list: shape paginado, búsqueda (ilike), filtros de stock, orden por cantidad
 *   - stats: conteos por rango de stock
 *   - create/update/delete: payload, .eq('id'), validación de cantidad ≥ 0
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, findFilter, filterValue } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeRequest, makeParams } from '../helpers/request'
import * as listRoute from '@/app/api/inventory/route'
import * as statsRoute from '@/app/api/inventory/stats/route'
import * as itemRoute from '@/app/api/inventory/[id]/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const url = (qs = '') => ({ url: `http://localhost/api/inventory${qs}`, method: 'GET' })

describe('GET /inventory (list)', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await listRoute.GET(makeRequest(undefined, url()))
    expect(res.status).toBe(401)
  })

  test('shape paginado + orden por model_code por defecto', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'store_inventory_with_brand.select': { data: [{ id: '1' }], error: null, count: 1 } },
    })
    const res = await listRoute.GET(makeRequest(undefined, url('?page=1&pageSize=20')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(1)
    expect(body.totalPages).toBe(1)
    const rec = activeClient.callsTo('store_inventory_with_brand', 'select')[0]
    expect(findFilter(rec, 'model_code', 'order')).toBeTruthy()
  })

  test('búsqueda usa ilike sobre model_code', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'store_inventory_with_brand.select': { data: [], error: null, count: 0 } },
    })
    await listRoute.GET(makeRequest(undefined, url('?search=ABC')))
    const rec = activeClient.callsTo('store_inventory_with_brand', 'select')[0]
    expect(findFilter(rec, 'model_code', 'ilike')).toBeTruthy()
  })

  test('filtro sin_stock → quantity = 0', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'store_inventory_with_brand.select': { data: [], error: null, count: 0 } },
    })
    await listRoute.GET(makeRequest(undefined, url('?stockFilter=sin_stock')))
    const rec = activeClient.callsTo('store_inventory_with_brand', 'select')[0]
    expect(filterValue(rec, 'quantity')).toBe(0)
  })

  // ── Filtro por marca (issue #53) ───────────────────────────────────────
  // La marca NO vive en store_inventory: se resuelve contra etm_products en la
  // vista, y por eso el listado lee de ahí — filtrar antes de paginar.
  const emptyList = { 'store_inventory_with_brand.select': { data: [], error: null, count: 0 } }

  test('marca concreta → eq sobre brand, normalizada a mayúsculas', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: emptyList })
    await listRoute.GET(makeRequest(undefined, url('?brand=surtek')))
    const rec = activeClient.callsTo('store_inventory_with_brand', 'select')[0]
    expect(filterValue(rec, 'brand')).toBe('SURTEK')
  })

  test('marca vacía (__none__) → is null, no eq', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: emptyList })
    await listRoute.GET(makeRequest(undefined, url('?brand=__none__')))
    const rec = activeClient.callsTo('store_inventory_with_brand', 'select')[0]
    // Son ~40 productos con stock real: se filtran, no se esconden.
    expect(findFilter(rec, 'brand', 'is')).toBeTruthy()
    expect(findFilter(rec, 'brand', 'eq')).toBeUndefined()
  })

  test('sin brand no se filtra por marca', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: emptyList })
    await listRoute.GET(makeRequest(undefined, url()))
    const rec = activeClient.callsTo('store_inventory_with_brand', 'select')[0]
    expect(findFilter(rec, 'brand', 'eq')).toBeUndefined()
    expect(findFilter(rec, 'brand', 'is')).toBeUndefined()
  })

  test('stockFilter=with_stock → quantity > 0 (default de la página)', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: emptyList })
    await listRoute.GET(makeRequest(undefined, url('?stockFilter=with_stock')))
    const rec = activeClient.callsTo('store_inventory_with_brand', 'select')[0]
    expect(findFilter(rec, 'quantity', 'gt')).toBeTruthy()
    expect(filterValue(rec, 'quantity', 'gt')).toBe(0)
  })

  test('stockFilter inválido cae a all (sin filtro de cantidad)', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: emptyList })
    await listRoute.GET(makeRequest(undefined, url('?stockFilter=garbage')))
    const rec = activeClient.callsTo('store_inventory_with_brand', 'select')[0]
    expect(findFilter(rec, 'quantity', 'gt')).toBeUndefined()
    expect(findFilter(rec, 'quantity', 'eq')).toBeUndefined()
  })

  test('quantitySort ordena por quantity', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'store_inventory_with_brand.select': { data: [], error: null, count: 0 } },
    })
    await listRoute.GET(makeRequest(undefined, url('?quantitySort=asc')))
    const rec = activeClient.callsTo('store_inventory_with_brand', 'select')[0]
    expect(findFilter(rec, 'quantity', 'order')).toBeTruthy()
  })
})

describe('GET /inventory/stats', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await statsRoute.GET()
    expect(res.status).toBe(401)
  })

  test('cuenta por rango de stock', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'store_inventory.select': {
          data: [{ quantity: 0 }, { quantity: 3 }, { quantity: 10 }, { quantity: 5 }],
          error: null,
        },
      },
    })
    const res = await statsRoute.GET()
    const body = await res.json()
    // with_stock (>0) es el default de la página: agrupa low_stock + in_stock.
    expect(body).toMatchObject({ total: 4, sin_stock: 1, low_stock: 2, in_stock: 1, with_stock: 3 })
  })

  test('incluye los conteos por marca de la RPC (para el selector)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'store_inventory.select': { data: [{ quantity: 1 }], error: null },
        'rpc.inventory_brand_counts': {
          data: [
            { brand: 'URREA', total: 171, with_stock: 57 },
            { brand: null, total: 40, with_stock: 26 },
          ],
          error: null,
        },
      },
    })
    const body = await (await statsRoute.GET()).json()
    // La marca null se conserva: el front la muestra como "Sin marca".
    expect(body.brands).toEqual([
      { brand: 'URREA', total: 171, with_stock: 57 },
      { brand: null, total: 40, with_stock: 26 },
    ])
  })

  test('si la RPC de marcas falla, las métricas de stock siguen respondiendo', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'store_inventory.select': { data: [{ quantity: 0 }], error: null },
        'rpc.inventory_brand_counts': { data: null, error: { message: 'boom' } },
      },
    })
    const res = await statsRoute.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.brands).toEqual([])
  })
})

describe('POST /inventory (create)', () => {
  test('400 si falta model_code', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await listRoute.POST(makeRequest({ quantity: 5 }))
    expect(res.status).toBe(400)
  })

  test('crea normalizando cantidad negativa a 0', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'store_inventory.insert': { data: { id: '1' }, error: null } },
    })
    const res = await listRoute.POST(makeRequest({ model_code: '  M1  ', quantity: -4 }))
    expect(res.status).toBe(201)
    const payload = activeClient.insertPayload<Record<string, unknown>>('store_inventory')
    expect(payload).toMatchObject({ model_code: 'M1', quantity: 0 })
  })

  test('código duplicado → 400', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'store_inventory.insert': { data: null, error: { code: '23505' } } },
    })
    const res = await listRoute.POST(makeRequest({ model_code: 'M1', quantity: 1 }))
    expect(res.status).toBe(400)
  })

  test('guarda location (trim); vacío → null', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'store_inventory.insert': { data: { id: '1' }, error: null } },
    })
    await listRoute.POST(makeRequest({ model_code: 'M1', quantity: 3, location: '  A-12  ' }))
    expect(activeClient.insertPayload<Record<string, unknown>>('store_inventory').location).toBe('A-12')

    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'store_inventory.insert': { data: { id: '2' }, error: null } },
    })
    await listRoute.POST(makeRequest({ model_code: 'M2', quantity: 3, location: '   ' }))
    expect(activeClient.insertPayload<Record<string, unknown>>('store_inventory').location).toBeNull()
  })
})

describe('PATCH /inventory/[id]', () => {
  test('400 cantidad negativa', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await itemRoute.PATCH(makeRequest({ quantity: -1 }, { method: 'PATCH' }), makeParams({ id: '1' }))
    expect(res.status).toBe(400)
  })

  test('actualiza por id', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'store_inventory.update': { data: { id: '1', quantity: 7 }, error: null } },
    })
    const res = await itemRoute.PATCH(makeRequest({ quantity: 7 }, { method: 'PATCH' }), makeParams({ id: '1' }))
    expect(res.status).toBe(200)
    const rec = activeClient.callsTo('store_inventory', 'update')[0]
    expect(filterValue(rec, 'id')).toBe('1')
    expect(activeClient.updatePayload('store_inventory')).toMatchObject({ quantity: 7 })
  })

  test('actualiza location; y no la incluye si no viene en el body', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'store_inventory.update': { data: { id: '1' }, error: null } },
    })
    await itemRoute.PATCH(makeRequest({ location: 'B-3' }, { method: 'PATCH' }), makeParams({ id: '1' }))
    expect(activeClient.updatePayload('store_inventory')).toMatchObject({ location: 'B-3' })

    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'store_inventory.update': { data: { id: '1' }, error: null } },
    })
    await itemRoute.PATCH(makeRequest({ quantity: 4 }, { method: 'PATCH' }), makeParams({ id: '1' }))
    expect(activeClient.updatePayload<Record<string, unknown>>('store_inventory')).not.toHaveProperty('location')
  })
})

describe('DELETE /inventory/[id]', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await itemRoute.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: '1' }))
    expect(res.status).toBe(401)
  })

  test('elimina por id', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'store_inventory.delete': { data: null, error: null } },
    })
    const res = await itemRoute.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: '1' }))
    expect(res.status).toBe(200)
    const rec = activeClient.callsTo('store_inventory', 'delete')[0]
    expect(filterValue(rec, 'id')).toBe('1')
  })
})
