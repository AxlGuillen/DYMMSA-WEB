/** Order lines (add / edit / remove) and the stock they move (#157). */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, filterValue } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { orderRpc, stockRpc } from '../helpers/stock-rpc'
import { AUTH } from '../helpers/factories'
import { makeRequest, makeParams } from '../helpers/request'
import * as items from '@/app/api/orders/[id]/items/route'
import * as itemById from '@/app/api/orders/[id]/items/[itemId]/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const order = (status: string) => ({ 'orders.select': { data: { id: 'o1', status }, error: null } })

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: 'it1', order_id: 'o1', item_type: 'product', etm: 'E1', model_code: 'MC1', description: 'Martillo',
    brand: 'URREA', quantity_approved: 3, quantity_in_stock: 2, quantity_to_order: 1, quantity_received: 0,
    urrea_status: 'pending', delivery_time: 'immediate', unit_price: 100, sort_order: 0,
    ...overrides,
  }
}

describe('POST /orders/[id]/items', () => {
  const add = (body: Record<string, unknown>) =>
    items.POST(makeRequest(body), makeParams({ id: 'o1' }))
  const valid = { etm: 'E9', description: 'Pinza', model_code: 'MC1', brand: 'URREA', unit_price: 50, quantity_approved: 4 }

  test('404 si la orden no existe', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'orders.select': { data: null, error: null } } })
    expect((await add(valid)).status).toBe(404)
  })

  test('400 en una orden completada o cancelada', async () => {
    for (const status of ['completed', 'cancelled']) {
      activeClient = createMockSupabase({ user: AUTH, responses: order(status) })
      expect((await add(valid)).status, status).toBe(400)
      expect(activeClient._rpcCalls, status).toEqual([])
    }
  })

  test('REGLA (#157): a una orden entregada ya no se le agregan productos ni se aparta stock', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: order('delivered') })
    const res = await add(valid)
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/entregada/)
    expect(activeClient._rpcCalls).toEqual([])
    expect(activeClient.didCall('order_items', 'insert')).toBe(false)
  })

  test('400 con cantidad no entera o menor a 1, o precio inválido, sin apartar stock', async () => {
    for (const body of [
      { ...valid, quantity_approved: 1.5 },
      { ...valid, quantity_approved: 0 },
      { ...valid, unit_price: -1 },
      { ...valid, unit_price: undefined },
    ]) {
      activeClient = createMockSupabase({ user: AUTH, responses: order('ordered') })
      expect((await add(body)).status).toBe(400)
      expect(activeClient._rpcCalls).toEqual([])
    }
  })

  test('aparta del stock, inserta al final y recalcula el total', async () => {
    const stock = stockRpc({ MC1: 10 })
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        ...stock.responses,
        ...order('received'),
        'order_items.select': (rec) => rec.single
          ? { data: { sort_order: 7 }, error: null }
          : { data: [line(), { unit_price: 50, quantity_approved: 4, item_type: 'product' }], error: null },
        'order_items.insert': { data: { id: 'new' }, error: null },
        'orders.update': { data: null, error: null },
      },
    })
    const res = await add(valid)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item).toEqual({ id: 'new' })
    expect(body.total_amount).toBe(500) // 100×3 + 50×4

    const inserted = activeClient.insertPayload<Record<string, unknown>>('order_items')
    expect(inserted).toMatchObject({ order_id: 'o1', sort_order: 8, quantity_in_stock: 4, quantity_to_order: 0 })
    expect(stock.quantity('MC1')).toBe(6)
  })

  test('REGLA (#157): si el insert falla, el stock apartado regresa', async () => {
    const stock = stockRpc({ MC1: 3 })
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        ...stock.responses,
        ...order('ordered'),
        'order_items.insert': { data: null, error: { message: 'connection reset' } },
      },
    })
    const res = await add(valid)
    expect(res.status).toBe(500)
    expect((await res.json()).message).toBe('Error al agregar el producto')
    // Before #157 the 3 stayed deducted for a line that was never saved.
    expect(stock.quantity('MC1')).toBe(3)
    expect(activeClient.didCall('orders', 'update')).toBe(false)
  })

  test('una violación de regla en el insert → 400 descriptivo, también devuelve el stock', async () => {
    const stock = stockRpc({ MC1: 3 })
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        ...stock.responses,
        ...order('ordered'),
        'order_items.insert': {
          data: null,
          error: { code: '23514', message: 'violates check constraint "order_items_unit_price_check"' },
        },
      },
    })
    const res = await add({ ...valid, etm: 'NEG' })
    expect(res.status).toBe(400)
    expect(stock.quantity('MC1')).toBe(3)
  })

  test('sin model_code no aparta nada: todo va a pedir', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { ...order('ordered'), 'order_items.insert': { data: { id: 'new' }, error: null } },
    })
    expect((await add({ ...valid, model_code: '' })).status).toBe(200)
    expect(activeClient._rpcCalls).toEqual([])
    expect(activeClient.insertPayload<Record<string, unknown>>('order_items')).toMatchObject({
      quantity_in_stock: 0, quantity_to_order: 4,
    })
  })
})

describe('PATCH /orders/[id]/items/[itemId]', () => {
  const patch = (body: Record<string, unknown>) =>
    itemById.PATCH(makeRequest(body, { method: 'PATCH' }), makeParams({ id: 'o1', itemId: 'it1' }))

  function editMock(status: string, overrides: Record<string, unknown> = {}) {
    return createMockSupabase({
      user: AUTH,
      responses: {
        ...order(status),
        'order_items.select': (rec) => rec.single
          ? { data: line(), error: null }
          : { data: [line({ unit_price: 120 })], error: null },
        'order_items.update': { data: null, error: null },
        'orders.update': { data: null, error: null },
        ...overrides,
      },
    })
  }

  test('404 si el producto no es de la orden', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { ...order('ordered'), 'order_items.select': { data: null, error: null } },
    })
    expect((await patch({ unit_price: 10 })).status).toBe(404)
  })

  test('400 con precio negativo, tiempo de entrega desconocido o sin cambios', async () => {
    for (const body of [{ unit_price: -1 }, { delivery_time: 'someday' }, {}]) {
      activeClient = editMock('ordered')
      expect((await patch(body)).status).toBe(400)
      expect(activeClient.didCall('order_items', 'update')).toBe(false)
    }
  })

  test('cambia el precio acotado a la orden y regresa el total recalculado', async () => {
    activeClient = editMock('ordered')
    const res = await patch({ unit_price: 120 })
    expect(res.status).toBe(200)
    expect((await res.json()).total_amount).toBe(360) // 120 × 3
    const update = activeClient.callsTo('order_items', 'update')[0]
    expect(update.payload).toEqual({ unit_price: 120 })
    expect(filterValue(update, 'order_id')).toBe('o1')
  })

  test('REGLA (#157): si el update falla responde error, no éxito', async () => {
    activeClient = editMock('ordered', {
      'order_items.update': { data: null, error: { message: 'connection reset' } },
    })
    const res = await patch({ delivery_time: '1_week' })
    expect(res.status).toBe(500)
    expect((await res.json()).message).toBe('Error al actualizar el producto')
  })

  test('una violación de regla en el update → 400', async () => {
    activeClient = editMock('ordered', {
      'order_items.update': {
        data: null,
        error: { code: '23514', message: 'violates check constraint "order_items_delivery_time_check"' },
      },
    })
    expect((await patch({ delivery_time: '1_week' })).status).toBe(400)
  })

  test('una orden entregada sigue permitiendo corregir precio y entrega (no mueve stock)', async () => {
    activeClient = editMock('delivered')
    expect((await patch({ delivery_time: '2_weeks' })).status).toBe(200)
  })

  test('400 en una orden completada', async () => {
    activeClient = editMock('completed')
    expect((await patch({ unit_price: 1 })).status).toBe(400)
  })
})

describe('DELETE /orders/[id]/items/[itemId]', () => {
  const remove = () => itemById.DELETE(makeRequest(), makeParams({ id: 'o1', itemId: 'it1' }))

  /** remove_order_item_restock over one in-memory order: guard on the status read, then delete + restock. */
  function removeMock(status: string, item: Record<string, unknown>, initialStock: Record<string, number> = { MC1: 5 }) {
    const stock = stockRpc(initialStock)
    const persisted = line(item)
    const { order: mockOrder, responses } = orderRpc(stock, {
      id: 'o1',
      status,
      items: [{
        id: persisted.id, model_code: persisted.model_code, etm: persisted.etm, item_type: 'product',
        quantity_in_stock: persisted.quantity_in_stock, quantity_received: persisted.quantity_received,
        quantity_to_order: persisted.quantity_to_order,
      }],
    })
    const client = createMockSupabase({
      user: AUTH,
      responses: {
        ...responses,
        ...order(status),
        'order_items.select': (rec) => rec.single
          ? { data: persisted, error: null }
          : { data: [], error: null },
        'orders.update': { data: null, error: null },
      },
    })
    return { client, stock, mockOrder }
  }

  test('404 si el producto no es de la orden', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { ...order('ordered'), 'order_items.select': { data: null, error: { code: 'PGRST116', message: 'no rows' } } },
    })
    expect((await remove()).status).toBe(404)
  })

  test('REGLA (#157): de una orden entregada ya no se quitan productos (su stock ya salió)', async () => {
    const { client, stock } = removeMock('delivered', {})
    activeClient = client
    const res = await remove()
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/entregada.*ajusta el inventario a mano/)
    expect(activeClient._rpcCalls).toEqual([])
    expect(stock.quantity('MC1')).toBe(5)
  })

  test('400 en una orden completada o cancelada', async () => {
    for (const status of ['completed', 'cancelled']) {
      const { client } = removeMock(status, {})
      activeClient = client
      expect((await remove()).status, status).toBe(400)
      expect(activeClient._rpcCalls, status).toEqual([])
    }
  })

  test('quita la línea y devuelve su stock apartado en una sola llamada atómica', async () => {
    const { client, stock, mockOrder } = removeMock('received', { quantity_in_stock: 2 })
    activeClient = client
    const res = await remove()
    expect(res.status).toBe(200)
    expect((await res.json()).total_amount).toBe(0)
    expect(stock.quantity('MC1')).toBe(7) // 5 + 2
    expect(mockOrder.items).toEqual([])
    // The DB reads what to give back from the row it deletes (#157).
    expect(activeClient.rpcParams('remove_order_item_restock')).toEqual([
      { p_order_id: 'o1', p_item_id: 'it1', p_expected_status: 'received' },
    ])
    expect(activeClient.didCall('order_items', 'delete')).toBe(false)
  })

  test('una línea sin stock apartado se quita sin mover inventario', async () => {
    const { client, stock } = removeMock('ordered', { quantity_in_stock: 0, quantity_to_order: 3 })
    activeClient = client
    expect((await remove()).status).toBe(200)
    expect(stock.quantity('MC1')).toBe(5)
  })

  test('REGLA (#157): si la orden cambió de estado a la mitad → 409 y no devuelve stock', async () => {
    const { client, stock, mockOrder } = removeMock('ordered', { quantity_in_stock: 2 })
    mockOrder.status = 'delivered' // moved by another request after this one read 'ordered'
    activeClient = client
    expect((await remove()).status).toBe(409)
    expect(stock.quantity('MC1')).toBe(5)
  })

  test('un error de la BD responde 500', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        ...order('ordered'),
        'order_items.select': { data: line(), error: null },
        'rpc.remove_order_item_restock': { data: null, error: { message: 'connection reset' } },
      },
    })
    expect((await remove()).status).toBe(500)
  })
})
