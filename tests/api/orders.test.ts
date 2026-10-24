import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, filterValue } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { orderRpc, stockRpc } from '../helpers/stock-rpc'
import { AUTH, orderProduct } from '../helpers/factories'
import { makeRequest, makeParams } from '../helpers/request'
import * as create from '@/app/api/orders/create/route'
import * as orderById from '@/app/api/orders/[id]/route'
import * as cancel from '@/app/api/orders/[id]/cancel/route'
import * as orderStatus from '@/app/api/orders/[id]/status/route'
import * as confirmReception from '@/app/api/orders/[id]/confirm-reception/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

describe('POST /orders/create', () => {
  test('400 sin customer_name o sin productos', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await create.POST(makeRequest({ customer_name: '', products: [] }))).status).toBe(400)
    expect((await create.POST(makeRequest({ customer_name: 'ACME', products: [] }))).status).toBe(400)
  })

  function createMock(stock: ReturnType<typeof stockRpc>, overrides: Record<string, unknown> = {}) {
    return createMockSupabase({
      user: AUTH,
      responses: {
        ...stock.responses,
        'orders.insert': { data: { id: 'o1', customer_name: 'ACME' }, error: null },
        'order_items.insert': { data: null, error: null },
        ...overrides,
      },
    })
  }

  test('REGLA: deduce stock al crear cuando hay inventario suficiente', async () => {
    const stock = stockRpc({ MC1: 10 })
    activeClient = createMock(stock)
    const res = await create.POST(makeRequest({
      customer_name: 'ACME',
      products: [orderProduct({ quantity: 4, price: 100 })],
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order_id).toBe('o1')
    expect(body.total_amount).toBe(400)        // 100 * 4
    expect(body.items_to_order).toBe(0)         // stock covers everything
    expect(body.inventory_updated).toBe(1)

    expect(stock.quantity('MC1')).toBe(6)       // 10 - 4
    const items = activeClient.insertPayload('order_items')
    expect(items[0].quantity_in_stock).toBe(4)
    expect(items[0].quantity_to_order).toBe(0)
  })

  test('REGLA: allocateInventory divide stock/pedido cuando es parcial', async () => {
    const stock = stockRpc({ MC1: 3 })
    activeClient = createMock(stock)
    const res = await create.POST(makeRequest({
      customer_name: 'ACME',
      products: [orderProduct({ quantity: 10, price: 50 })],
    }))
    const body = await res.json()
    expect(body.items_to_order).toBe(1)
    const items = activeClient.insertPayload('order_items')
    expect(items[0].quantity_in_stock).toBe(3)
    expect(items[0].quantity_to_order).toBe(7)   // 10 - 3
    // invariant: in_stock + to_order = approved
    expect((items[0].quantity_in_stock as number) + (items[0].quantity_to_order as number)).toBe(10)
    expect(stock.quantity('MC1')).toBe(0)
  })

  test('REGLA (#157): dos líneas con el mismo model_code se apartan contra UN solo stock', async () => {
    const stock = stockRpc({ MC1: 6 })
    activeClient = createMock(stock)
    const res = await create.POST(makeRequest({
      customer_name: 'ACME',
      products: [orderProduct({ etm: 'A', quantity: 5 }), orderProduct({ etm: 'B', quantity: 5 })],
    }))
    expect(res.status).toBe(200)
    const items = activeClient.insertPayload('order_items')
    // Before #157 both lines took 5 against the same 6 (10 reserved) and stock ended at 1.
    expect(items.map((i) => [i.quantity_in_stock, i.quantity_to_order])).toEqual([[5, 0], [1, 4]])
    expect(stock.quantity('MC1')).toBe(0)
    // One reservation per model_code, with the demand summed.
    expect(activeClient.rpcParams('reserve_inventory')).toEqual([{ p_lines: [{ model_code: 'MC1', quantity: 10 }] }])
    expect((await res.json()).inventory_updated).toBe(1)
  })

  test('REGLA: rollback — si falla insert de order_items, borra la orden y devuelve lo apartado', async () => {
    const stock = stockRpc({ MC1: 10 })
    activeClient = createMock(stock, { 'order_items.insert': { data: null, error: { message: 'fail' } } })
    const res = await create.POST(makeRequest({
      customer_name: 'ACME',
      products: [orderProduct({ quantity: 1, price: 10 })],
    }))
    expect(res.status).toBe(500)
    expect(activeClient.didCall('orders', 'delete')).toBe(true)
    // The reservation went back (#157): no stock stays taken by an order that does not exist.
    expect(activeClient.rpcParams('release_inventory')).toEqual([{ p_lines: [{ model_code: 'MC1', quantity: 1 }] }])
    expect(stock.quantity('MC1')).toBe(10)
  })

  test('si falla el apartado, borra la orden sin insertar ítems', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.insert': { data: { id: 'o1', customer_name: 'ACME' }, error: null },
        'rpc.reserve_inventory': { data: null, error: { message: 'connection reset' } },
      },
    })
    const res = await create.POST(makeRequest({ customer_name: 'ACME', products: [orderProduct()] }))
    expect(res.status).toBe(500)
    expect(activeClient.didCall('order_items', 'insert')).toBe(false)
    expect(activeClient.didCall('orders', 'delete')).toBe(true)
  })

  test('REGLA: constraint unit_price_check (precio negativo) → 400 con offendingEtm', async () => {
    // orders/create does `quantity || 1`, so quantity=0 never reaches the DB;
    // price is preserved, so we test with a negative price instead.
    const stock = stockRpc()
    activeClient = createMock(stock, {
      'order_items.insert': {
        data: null,
        error: {
          code: '23514',
          message: 'violates check constraint "order_items_unit_price_check"',
        },
      },
    })
    const res = await create.POST(makeRequest({
      customer_name: 'ACME',
      products: [orderProduct({ etm: 'NEG-ORDER', quantity: 1, price: -5 })],
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.offendingEtm).toBe('NEG-ORDER')
    expect(body.message).toContain('NEG-ORDER')
    expect(activeClient.didCall('orders', 'delete')).toBe(true)
  })
})

describe('PATCH /orders/[id]', () => {
  test('404 si la orden no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: null, error: null } },
    })
    const res = await orderById.PATCH(makeRequest({ odoo_id: 'X' }), makeParams({ id: 'o1' }))
    expect(res.status).toBe(404)
  })

  test('400 si no hay cambios (body sin odoo_id)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: { id: 'o1' }, error: null } },
    })
    const res = await orderById.PATCH(makeRequest({}), makeParams({ id: 'o1' }))
    expect(res.status).toBe(400)
  })

  test('actualiza odoo_id', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1' }, error: null },
        'orders.update': { data: { odoo_id: 'ODOO-99' }, error: null },
      },
    })
    const res = await orderById.PATCH(makeRequest({ odoo_id: 'ODOO-99' }), makeParams({ id: 'o1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.odoo_id).toBe('ODOO-99')
    const upd = activeClient.updatePayload('orders')
    expect(upd.odoo_id).toBe('ODOO-99')
  })
})

type Line = Parameters<typeof orderRpc>[1]['items'][number]

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: 'it1', model_code: 'MC1', etm: 'ETM1', item_type: 'product',
    quantity_in_stock: 0, quantity_received: 0, quantity_to_order: 0, urrea_status: 'pending',
    ...overrides,
  }
}

/** A mock client whose order functions run against one in-memory order and its stock. */
function orderMock(status: string, items: Line[], initialStock: Record<string, number> = { MC1: 5 }) {
  const stock = stockRpc(initialStock)
  const { order, responses } = orderRpc(stock, { id: 'o1', status, items })
  const client = createMockSupabase({
    user: AUTH,
    responses: {
      ...stock.responses,
      ...responses,
      'orders.select': { data: { id: 'o1', status }, error: null },
      'order_items.select': { data: [], error: null },
      'orders.update': { data: null, error: null },
    },
  })
  return { client, stock, order }
}

describe('DELETE /orders/[id]', () => {
  const del = () => orderById.DELETE(makeRequest(), makeParams({ id: 'o1' }))

  test('404 si la orden no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: null, error: { code: 'PGRST116', message: 'no rows' } } },
    })
    expect((await del()).status).toBe(404)
  })

  test('REGLA (#157): un error al leer la orden es 500, no 404', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: null, error: { code: '08006', message: 'connection failure' } } },
    })
    expect((await del()).status).toBe(500)
  })

  test('REGLA: restaura inventario y borra la orden en una sola llamada atómica', async () => {
    const { client, stock, order } = orderMock('ordered', [line({ quantity_in_stock: 3 })])
    activeClient = client
    const res = await del()
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(stock.quantity('MC1')).toBe(8) // 5 + 3
    expect(order.status).toBe('deleted')
    // What to give back is read by the DB under the order lock (#157), never passed from here.
    expect(activeClient.rpcParams('delete_order_restock')).toEqual([
      { p_order_id: 'o1', p_expected_status: 'ordered', p_restock: true },
    ])
    expect(activeClient.didCall('order_items', 'select')).toBe(false)
    expect(activeClient.didCall('orders', 'delete')).toBe(false)
  })

  test('REGLA: una orden cancelada se borra sin restaurar otra vez (cancelar ya lo hizo)', async () => {
    const { client, stock } = orderMock('cancelled', [line({ quantity_in_stock: 3 })])
    activeClient = client
    expect((await del()).status).toBe(200)
    expect(activeClient.rpcParams('delete_order_restock')[0].p_restock).toBe(false)
    expect(stock.quantity('MC1')).toBe(5)
  })

  test('REGLA: entregada o completada se borra sin devolver al inventario lo que ya salió', async () => {
    for (const status of ['delivered', 'completed']) {
      const { client, stock } = orderMock(status, [line({ quantity_in_stock: 3, quantity_received: 2, quantity_to_order: 2 })])
      activeClient = client
      expect((await del()).status, status).toBe(200)
      expect(stock.quantity('MC1'), status).toBe(5)
      expect(activeClient.rpcParams('delete_order_restock')[0].p_restock, status).toBe(false)
    }
  })

  test('REGLA (#157): si la orden cambió (reintento o carrera) → 409 y no devuelve stock', async () => {
    const { client, stock, order } = orderMock('ordered', [line({ quantity_in_stock: 3 })])
    order.status = 'delivered' // another request moved it after this one read 'ordered'
    activeClient = client
    const res = await del()
    expect(res.status).toBe(409)
    expect((await res.json()).message).toMatch(/Recarga/)
    expect(stock.quantity('MC1')).toBe(5)
  })

  test('REGLA (#157): un error de la BD responde 500, nunca success', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'completed' }, error: null },
        'rpc.delete_order_restock': { data: null, error: { message: 'connection reset' } },
      },
    })
    expect((await del()).status).toBe(500)
  })
})

describe('PATCH /orders/[id]/status', () => {
  const patch = (status: string) =>
    orderStatus.PATCH(makeRequest({ status }, { method: 'PATCH' }), makeParams({ id: 'o1' }))

  const statusMock = (current: string) =>
    createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: current }, error: null },
        'orders.update': (rec) => ({ data: { id: 'o1', status: (rec.payload as { status: string }).status }, error: null }),
      },
    })

  test('cambia entre los estados manuales, con guarda sobre el estado leído', async () => {
    activeClient = statusMock('ordered')
    const res = await patch('delivered')
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('delivered')
    const update = activeClient.callsTo('orders', 'update')[0]
    expect(update.payload).toEqual({ status: 'delivered' })
    expect(filterValue(update, 'status')).toBe('ordered')
  })

  test('REGLA (#157): entregada o completada ya no regresa a Pedida ni a Recibida', async () => {
    for (const [from, to] of [['delivered', 'ordered'], ['delivered', 'received'], ['completed', 'received'], ['completed', 'ordered']]) {
      activeClient = statusMock(from)
      const res = await patch(to)
      expect(res.status, `${from} → ${to}`).toBe(400)
      expect((await res.json()).message).toBe('La orden ya se entregó: no puede regresar a Pedida ni a Recibida')
      expect(activeClient.didCall('orders', 'update'), `${from} → ${to}`).toBe(false)
    }
  })

  test('entregada ↔ completada sigue permitido', async () => {
    for (const [from, to] of [['delivered', 'completed'], ['completed', 'delivered']]) {
      activeClient = statusMock(from)
      expect((await patch(to)).status, `${from} → ${to}`).toBe(200)
    }
  })

  test('si otra petición cambió el estado a la mitad → 409', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null },
        'orders.update': { data: null, error: { code: 'PGRST116', message: 'no rows' } },
      },
    })
    expect((await patch('received')).status).toBe(409)
  })

  test('REGLA: "cancelled" no es destino manual — solo /cancel, que restaura el inventario', async () => {
    activeClient = statusMock('ordered')
    const res = await patch('cancelled')
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/Cancelar orden/)
    expect(activeClient.didCall('orders', 'update')).toBe(false)
  })

  test('REGLA: una orden cancelada ya no cambia de estado (borrarla después duplicaría el stock)', async () => {
    activeClient = statusMock('cancelled')
    const res = await patch('ordered')
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/cancelada/)
    expect(activeClient.didCall('orders', 'update')).toBe(false)
  })

  test('400 con un estado desconocido', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await patch('lost')).status).toBe(400)
  })
})

describe('POST /orders/[id]/cancel', () => {
  const doCancel = () => cancel.POST(makeRequest(), makeParams({ id: 'o1' }))

  test('404 si no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: null, error: { code: 'PGRST116', message: 'no rows' } } },
    })
    expect((await doCancel()).status).toBe(404)
  })

  test('400 si ya está cancelada', async () => {
    activeClient = orderMock('cancelled', []).client
    expect((await doCancel()).status).toBe(400)
  })

  test('400 si está completada', async () => {
    activeClient = orderMock('completed', []).client
    expect((await doCancel()).status).toBe(400)
  })

  test('REGLA (#157): una orden entregada ya no se cancela ni devuelve stock', async () => {
    const { client, stock } = orderMock('delivered', [line({ quantity_in_stock: 2 })])
    activeClient = client
    const res = await doCancel()
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/entregada.*ajusta el inventario a mano/)
    expect(activeClient._rpcCalls).toEqual([])
    expect(stock.quantity('MC1')).toBe(5)
  })

  test('REGLA: cancela y restaura inventario en una sola llamada atómica', async () => {
    const { client, stock, order } = orderMock(
      'ordered',
      [line({ quantity_in_stock: 2, quantity_received: 1, quantity_to_order: 1 })],
      { MC1: 4 },
    )
    activeClient = client
    const res = await doCancel()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.inventory_restored).toBe(1)
    expect(stock.quantity('MC1')).toBe(7) // 4 + (2 + 1)
    expect(order.status).toBe('cancelled')
    expect(activeClient.rpcParams('cancel_order_restock')).toEqual([{ p_order_id: 'o1', p_expected_status: 'ordered' }])
    // The status and the lines to give back are handled inside the function, in one transaction.
    expect(activeClient.didCall('orders', 'update')).toBe(false)
    expect(activeClient.didCall('order_items', 'select')).toBe(false)
  })

  test('REGLA (ADR-019): cancelar tras recepción con excedente NO duplica el excedente', async () => {
    const { client, stock } = orderMock(
      'received',
      // received 10, ordered 1: the 9 excess already entered on reception
      [line({ quantity_in_stock: 2, quantity_received: 10, quantity_to_order: 1 })],
      { MC1: 4 },
    )
    activeClient = client
    expect((await doCancel()).status).toBe(200)
    // restores in_stock 2 + min(10, 1) = 3 → 4 + 3 = 7 (NOT 4 + 12)
    expect(stock.quantity('MC1')).toBe(7)
  })

  test('REGLA (#157): un reintento tras un cambio concurrente → 409 y el stock no se duplica', async () => {
    // Both requests read 'ordered' before either wrote.
    const { client, stock } = orderMock('ordered', [line({ quantity_in_stock: 2 })], { MC1: 4 })
    activeClient = client
    expect((await doCancel()).status).toBe(200)
    const second = await doCancel()
    expect(second.status).toBe(409)
    expect(stock.quantity('MC1')).toBe(6) // 4 + 2 once, not 8
  })

  test('REGLA (#157): si la BD falla no se reporta éxito', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null },
        'rpc.cancel_order_restock': { data: null, error: { message: 'connection reset' } },
      },
    })
    expect((await doCancel()).status).toBe(500)
  })
})

describe('POST /orders/[id]/confirm-reception', () => {
  const receive = (items: unknown) =>
    confirmReception.POST(makeRequest({ items }), makeParams({ id: 'o1' }))
  const confirm = (quantity_received: number, id = 'it1') =>
    receive([{ id, quantity_received, urrea_status: 'supplied' }])

  function receptionMock(status: string, items: Line[], initialStock: Record<string, number> = { MC1: 0 }, finalItems: Record<string, unknown>[] = []) {
    const mock = orderMock(status, items, initialStock)
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        ...mock.stock.responses,
        ...orderRpc(mock.stock, mock.order).responses,
        'order_items.select': { data: finalItems, error: null },
        'orders.update': { data: null, error: null },
      },
    })
    return mock
  }

  test('400 sin items, con items que no son objetos o sin id', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    for (const items of [[], [null], ['it1'], [{ quantity_received: 1, urrea_status: 'supplied' }], null]) {
      const res = await receive(items)
      expect(res.status, JSON.stringify(items)).toBe(400)
    }
    expect(activeClient._rpcCalls).toEqual([])
  })

  test('400 si quantity_received es negativo o no entero', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await confirm(-1)).status).toBe(400)
    expect((await confirm(1.5)).status).toBe(400)
  })

  test('400 con un producto repetido o un estado de envío inválido, sin llamar a la BD', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const repeated = await receive([
      { id: 'it1', quantity_received: 1, urrea_status: 'supplied' },
      { id: 'it1', quantity_received: 2, urrea_status: 'supplied' },
    ])
    expect(repeated.status).toBe(400)
    const badStatus = await receive([{ id: 'it1', quantity_received: 1, urrea_status: 'lost' }])
    expect(badStatus.status).toBe(400)
    expect(activeClient._rpcCalls).toEqual([])
  })

  test('404 si la orden no existe', async () => {
    receptionMock('ordered', [line({ quantity_to_order: 2 })])
    const res = await confirmReception.POST(
      makeRequest({ items: [{ id: 'it1', quantity_received: 1, urrea_status: 'supplied' }] }),
      makeParams({ id: 'otra' }),
    )
    expect(res.status).toBe(404)
  })

  test('400 si la orden está completada o cancelada', async () => {
    for (const status of ['completed', 'cancelled']) {
      receptionMock(status, [line({ quantity_to_order: 2 })])
      expect((await confirm(1)).status, status).toBe(400)
    }
  })

  test('REGLA (#157): líneas y stock van en una sola llamada atómica', async () => {
    receptionMock('received', [line({ quantity_to_order: 2 })])
    expect((await confirm(5)).status).toBe(200)
    expect(activeClient.rpcParams('receive_order_items')).toEqual([
      { p_order_id: 'o1', p_items: [{ id: 'it1', quantity_received: 5, urrea_status: 'supplied' }] },
    ])
    expect(activeClient.didCall('order_items', 'update')).toBe(false)
  })

  test('REGLA (ADR-019): sin excedente NO toca inventario, solo el ítem y el total', async () => {
    const { stock, order } = receptionMock(
      'received',
      [line({ quantity_in_stock: 2, quantity_to_order: 3 })],
      { MC1: 4 },
      [{ quantity_in_stock: 2, quantity_received: 3, quantity_to_order: 3, urrea_status: 'supplied', unit_price: 100, item_type: 'product' }],
    )
    const res = await confirm(3) // received exactly what was ordered
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inventory_updated).toBe(0)
    expect(body.warnings).toEqual([])
    expect(stock.quantity('MC1')).toBe(4)
    expect(order.items[0].quantity_received).toBe(3)
    // total recomputed: (2 + min(3,3)) × 100 = 500
    expect(activeClient.updatePayload('orders').total_amount).toBe(500)
  })

  test('REGLA (ADR-019): el excedente entra a inventario y NO se factura (10 recibidos, 2 pedidos → +8)', async () => {
    const { stock } = receptionMock(
      'received',
      [line({ quantity_in_stock: 1, quantity_to_order: 2 })],
      { MC1: 5 },
      [{ quantity_in_stock: 1, quantity_received: 10, quantity_to_order: 2, urrea_status: 'supplied', unit_price: 100, item_type: 'product' }],
    )
    const res = await confirm(10)
    expect(res.status).toBe(200)
    expect((await res.json()).inventory_updated).toBe(1)
    expect(stock.quantity('MC1')).toBe(13) // 5 + excess 8, not 5 + 10
    // total capped: (in_stock 1 + min(10, 2)) × 100 = 300
    expect(activeClient.updatePayload('orders').total_amount).toBe(300)
  })

  test('REGLA (ADR-019): re-confirmar con el mismo valor es idempotente (delta 0)', async () => {
    const { stock } = receptionMock('received', [line({ quantity_received: 10, quantity_to_order: 2 })], { MC1: 13 })
    const res = await confirm(10)
    expect(res.status).toBe(200)
    expect((await res.json()).inventory_updated).toBe(0)
    expect(stock.quantity('MC1')).toBe(13)
  })

  test('corrección a la baja con stock insuficiente → clamp en 0 + warning legible', async () => {
    const { stock } = receptionMock('received', [line({ quantity_received: 10, quantity_to_order: 2 })], { MC1: 4 })
    const res = await confirm(2) // delta −8, 4 − 8 = −4 → 0
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(stock.quantity('MC1')).toBe(0)
    expect(body.warnings).toEqual([
      'ETM1: la corrección dejaría el stock en negativo; se ajustó a 0 (revisa el inventario de MC1).',
    ])
  })

  test('corrección a la baja sin fila de inventario → warning, sin crash', async () => {
    const { stock } = receptionMock('received', [line({ quantity_received: 10, quantity_to_order: 2 })], {})
    const res = await confirm(2)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warnings).toEqual(['ETM1: no existe fila de inventario de MC1 para restar la corrección del excedente.'])
    expect(body.inventory_updated).toBe(0)
    expect(stock.quantity('MC1')).toBeUndefined()
  })

  test('REGLA (#157): un ítem de OTRA orden → 400 y no escribe nada', async () => {
    const { stock, order } = receptionMock('received', [line({ quantity_to_order: 2 })], { MC1: 5 })
    const res = await confirm(10, 'it-other-order')
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/no pertenece a esta orden/)
    expect(order.items[0].quantity_received).toBe(0)
    expect(stock.quantity('MC1')).toBe(5)
  })

  test('un id malformado (22P02) también es 400, no 500', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'rpc.receive_order_items': { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } } },
    })
    expect((await confirm(1, 'no-es-uuid')).status).toBe(400)
  })

  test('REGLA (#157): una línea sin pedido a URREA no lleva recepción → 400 con su código', async () => {
    const { stock } = receptionMock('received', [line({ etm: 'E-77', quantity_to_order: 0, quantity_in_stock: 3 })], { MC1: 5 })
    const res = await confirm(4)
    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe('E-77: no se pidió a URREA (salió completo de stock), así que no lleva recepción')
    expect(stock.quantity('MC1')).toBe(5) // before #157 all 4 entered as "excess"
  })

  test('REGLA (#157): el lote es todo o nada', async () => {
    const { stock, order } = receptionMock(
      'received',
      [line({ id: 'it1', quantity_to_order: 2 }), line({ id: 'it2', model_code: 'MC2', quantity_to_order: 0 })],
      { MC1: 5 },
    )
    const res = await receive([
      { id: 'it1', quantity_received: 10, urrea_status: 'supplied' },
      { id: 'it2', quantity_received: 3, urrea_status: 'supplied' },
    ])
    expect(res.status).toBe(400)
    expect(order.items[0].quantity_received).toBe(0)
    expect(stock.quantity('MC1')).toBe(5)
  })

  test('un error inesperado de la BD es 500 y no reporta éxito', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'rpc.receive_order_items': { data: null, error: { code: '08006', message: 'connection failure' } } },
    })
    expect((await confirm(1)).status).toBe(500)
  })
})
