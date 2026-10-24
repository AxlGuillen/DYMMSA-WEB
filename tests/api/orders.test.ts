import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, hasFilter, filterValue } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { stockRpc } from '../helpers/stock-rpc'
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

/** The cancel/delete functions as the DB runs them: guard on the status read, then restock (#157). */
function guardedRestock(stock: ReturnType<typeof stockRpc>, current: { status: string }) {
  return (rec: { payload?: unknown }) => {
    const p = rec.payload as { p_expected_status: string; p_lines: { model_code: string; quantity: number }[] }
    if (p.p_expected_status !== current.status) return { data: false, error: null }
    current.status = 'gone'
    stock.release(p.p_lines)
    return { data: true, error: null }
  }
}

describe('DELETE /orders/[id]', () => {
  const del = () => orderById.DELETE(makeRequest(), makeParams({ id: 'o1' }))

  test('404 si la orden no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: null, error: null } },
    })
    expect((await del()).status).toBe(404)
  })

  test('REGLA: restaura inventario y borra la orden en una sola llamada atómica', async () => {
    const stock = stockRpc({ MC1: 5 })
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null },
        'order_items.select': { data: [{ model_code: 'MC1', quantity_in_stock: 3, quantity_received: 0, quantity_to_order: 0 }], error: null },
        'rpc.delete_order_restock': guardedRestock(stock, { status: 'ordered' }),
      },
    })
    const res = await del()
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(stock.quantity('MC1')).toBe(8) // 5 + 3
    expect(activeClient.rpcParams('delete_order_restock')).toEqual([
      { p_order_id: 'o1', p_expected_status: 'ordered', p_lines: [{ model_code: 'MC1', quantity: 3 }] },
    ])
    // The delete happens inside the function, never as loose writes from the route.
    expect(activeClient.didCall('order_items', 'delete')).toBe(false)
    expect(activeClient.didCall('orders', 'delete')).toBe(false)
  })

  test('REGLA: una orden cancelada se borra sin restaurar otra vez (cancelar ya lo hizo)', async () => {
    const stock = stockRpc({ MC1: 5 })
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'cancelled' }, error: null },
        'order_items.select': { data: [{ model_code: 'MC1', quantity_in_stock: 3, quantity_received: 0, quantity_to_order: 0 }], error: null },
        'rpc.delete_order_restock': guardedRestock(stock, { status: 'cancelled' }),
      },
    })
    expect((await del()).status).toBe(200)
    expect(activeClient.didCall('order_items', 'select')).toBe(false)
    expect(activeClient.rpcParams('delete_order_restock')[0].p_lines).toEqual([])
    expect(stock.quantity('MC1')).toBe(5)
  })

  test('REGLA: entregada o completada se borra sin devolver al inventario lo que ya salió', async () => {
    for (const status of ['delivered', 'completed']) {
      const stock = stockRpc({ MC1: 5 })
      activeClient = createMockSupabase({
        user: AUTH,
        responses: {
          'orders.select': { data: { id: 'o1', status }, error: null },
          'order_items.select': { data: [{ model_code: 'MC1', quantity_in_stock: 3, quantity_received: 2, quantity_to_order: 2 }], error: null },
          'rpc.delete_order_restock': guardedRestock(stock, { status }),
        },
      })
      expect((await del()).status, status).toBe(200)
      expect(stock.quantity('MC1'), status).toBe(5)
      expect(activeClient.rpcParams('delete_order_restock')[0].p_lines, status).toEqual([])
    }
  })

  test('REGLA (#157): si la orden cambió (reintento o carrera) → 409 y no devuelve stock', async () => {
    const stock = stockRpc({ MC1: 5 })
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null },
        'order_items.select': { data: [{ model_code: 'MC1', quantity_in_stock: 3, quantity_received: 0, quantity_to_order: 0 }], error: null },
        // Another request already moved it: the guarded delete affects no row.
        'rpc.delete_order_restock': guardedRestock(stock, { status: 'delivered' }),
      },
    })
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

  test('cambia entre los estados manuales', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null },
        'orders.update': { data: { id: 'o1', status: 'delivered' }, error: null },
      },
    })
    const res = await patch('delivered')
    expect(res.status).toBe(200)
    expect(activeClient.updatePayload('orders')).toEqual({ status: 'delivered' })
  })

  test('REGLA: "cancelled" no es destino manual — solo /cancel, que restaura el inventario', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null } },
    })
    const res = await patch('cancelled')
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/Cancelar orden/)
    expect(activeClient.didCall('orders', 'update')).toBe(false)
  })

  test('REGLA: una orden cancelada ya no cambia de estado (borrarla después duplicaría el stock)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: { id: 'o1', status: 'cancelled' }, error: null } },
    })
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
      responses: { 'orders.select': { data: null, error: null } },
    })
    expect((await doCancel()).status).toBe(404)
  })

  test('400 si ya está cancelada', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: { id: 'o1', status: 'cancelled' }, error: null } },
    })
    expect((await doCancel()).status).toBe(400)
  })

  test('400 si está completada', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: { id: 'o1', status: 'completed' }, error: null } },
    })
    expect((await doCancel()).status).toBe(400)
  })

  test('REGLA (#157): una orden entregada ya no se cancela ni devuelve stock', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: { id: 'o1', status: 'delivered' }, error: null } },
    })
    const res = await doCancel()
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/entregada.*ajusta el inventario a mano/)
    expect(activeClient._rpcCalls).toEqual([])
  })

  test('REGLA: cancela y restaura inventario en una sola llamada atómica', async () => {
    const stock = stockRpc({ MC1: 4 })
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null },
        'order_items.select': { data: [{ model_code: 'MC1', quantity_in_stock: 2, quantity_received: 1, quantity_to_order: 1 }], error: null },
        'rpc.cancel_order_restock': guardedRestock(stock, { status: 'ordered' }),
      },
    })
    const res = await doCancel()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.inventory_restored).toBe(1)
    expect(stock.quantity('MC1')).toBe(7) // 4 + (2 + 1)
    expect(activeClient.rpcParams('cancel_order_restock')).toEqual([
      { p_order_id: 'o1', p_expected_status: 'ordered', p_lines: [{ model_code: 'MC1', quantity: 3 }] },
    ])
    // The status changes inside the function, in the same transaction as the restock.
    expect(activeClient.didCall('orders', 'update')).toBe(false)
  })

  test('REGLA (ADR-019): cancelar tras recepción con excedente NO duplica el excedente', async () => {
    const stock = stockRpc({ MC1: 4 })
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'received' }, error: null },
        // received 10, ordered 1: the 9 excess already entered on reception
        'order_items.select': { data: [{ model_code: 'MC1', quantity_in_stock: 2, quantity_received: 10, quantity_to_order: 1 }], error: null },
        'rpc.cancel_order_restock': guardedRestock(stock, { status: 'received' }),
      },
    })
    expect((await doCancel()).status).toBe(200)
    // restores in_stock 2 + min(10, 1) = 3 → 4 + 3 = 7 (NOT 4 + 12)
    expect(stock.quantity('MC1')).toBe(7)
  })

  test('REGLA (#157): un reintento tras un cambio concurrente → 409 y el stock no se duplica', async () => {
    const stock = stockRpc({ MC1: 4 })
    const current = { status: 'ordered' }
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        // Both requests read 'ordered' before either wrote.
        'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null },
        'order_items.select': { data: [{ model_code: 'MC1', quantity_in_stock: 2, quantity_received: 0, quantity_to_order: 0 }], error: null },
        'rpc.cancel_order_restock': guardedRestock(stock, current),
      },
    })
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
        'order_items.select': { data: [], error: null },
        'rpc.cancel_order_restock': { data: null, error: { message: 'connection reset' } },
      },
    })
    expect((await doCancel()).status).toBe(500)
  })
})

describe('POST /orders/[id]/confirm-reception', () => {
  test('400 sin items', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await confirmReception.POST(makeRequest({ items: [] }), makeParams({ id: 'o1' }))).status).toBe(400)
  })

  test('404 si la orden no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: null, error: null } },
    })
    const res = await confirmReception.POST(
      makeRequest({ items: [{ id: 'it1', quantity_received: 1, urrea_status: 'supplied' }] }),
      makeParams({ id: 'o1' }),
    )
    expect(res.status).toBe(404)
  })

  test('400 si la orden está completada o cancelada', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: { id: 'o1', status: 'completed' }, error: null } },
    })
    const res = await confirmReception.POST(
      makeRequest({ items: [{ id: 'it1', quantity_received: 1, urrea_status: 'supplied' }] }),
      makeParams({ id: 'o1' }),
    )
    expect(res.status).toBe(400)
  })

  type Persisted = { id?: string; quantity_received: number; quantity_to_order: number; model_code?: string | null; item_type?: string }

  // The order's items read once up front (in id + order_id) and once at the end (order_id) for the total.
  function receptionMock(opts: {
    persisted: Persisted | Persisted[]
    inventory?: { quantity: number } | null
    finalItems?: Record<string, unknown>[]
  }) {
    const stock = stockRpc(opts.inventory === null ? {} : { MC1: opts.inventory?.quantity ?? 0 })
    const persisted = (Array.isArray(opts.persisted) ? opts.persisted : [opts.persisted]).map((p, i) => ({
      id: p.id ?? (i === 0 ? 'it1' : `it${i + 1}`),
      model_code: p.model_code === undefined ? 'MC1' : p.model_code,
      etm: 'ETM1',
      item_type: p.item_type ?? 'product',
      quantity_received: p.quantity_received,
      quantity_to_order: p.quantity_to_order,
    }))
    const client = createMockSupabase({
      user: AUTH,
      responses: {
        ...stock.responses,
        'orders.select': { data: { id: 'o1', status: 'received' }, error: null },
        'order_items.select': (rec) => {
          if (hasFilter(rec, 'id', 'in')) {
            const ids = filterValue(rec, 'id', 'in') as string[]
            // Only rows of THIS order come back, as PostgREST would with eq(order_id).
            const own = filterValue(rec, 'order_id') === 'o1' ? persisted : []
            return { data: own.filter((p) => ids.includes(p.id)), error: null }
          }
          return { data: opts.finalItems ?? [], error: null }
        },
        'order_items.update': { data: null, error: null },
        'orders.update': { data: null, error: null },
      },
    })
    return { client, stock }
  }

  const confirm = (quantity_received: number, id = 'it1') =>
    confirmReception.POST(
      makeRequest({ items: [{ id, quantity_received, urrea_status: 'supplied' }] }),
      makeParams({ id: 'o1' }),
    )

  test('400 si quantity_received es negativo o no entero', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await confirm(-1)).status).toBe(400)
    activeClient = createMockSupabase({ user: AUTH })
    expect((await confirm(1.5)).status).toBe(400)
  })

  test('REGLA (ADR-019): sin excedente NO toca inventario, solo actualiza el ítem y el total', async () => {
    const { client, stock } = receptionMock({
      persisted: { quantity_received: 0, quantity_to_order: 3 },
      inventory: { quantity: 4 },
      finalItems: [{ quantity_in_stock: 2, quantity_received: 3, quantity_to_order: 3, urrea_status: 'supplied', unit_price: 100, item_type: 'product' }],
    })
    activeClient = client
    const res = await confirm(3) // received exactly what was ordered
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inventory_updated).toBe(0)
    expect(body.warnings).toEqual([])
    expect(activeClient.rpcParams('adjust_inventory')).toEqual([])
    expect(stock.quantity('MC1')).toBe(4)

    // item updated and total recomputed: (2 + min(3,3)) × 100 = 500
    expect(activeClient.updatePayload('order_items').quantity_received).toBe(3)
    expect(activeClient.updatePayload('orders').total_amount).toBe(500)
  })

  test('REGLA (ADR-019): el excedente entra a inventario y NO se factura (10 recibidos, 2 pedidos → +8)', async () => {
    const { client, stock } = receptionMock({
      persisted: { quantity_received: 0, quantity_to_order: 2 },
      inventory: { quantity: 5 },
      finalItems: [{ quantity_in_stock: 1, quantity_received: 10, quantity_to_order: 2, urrea_status: 'supplied', unit_price: 100, item_type: 'product' }],
    })
    activeClient = client
    const res = await confirm(10)
    expect(res.status).toBe(200)
    expect((await res.json()).inventory_updated).toBe(1)

    // inventory: 5 + excess 8 = 13 (not 5 + 10), moved as a delta by the DB
    expect(activeClient.rpcParams('adjust_inventory')).toEqual([{ p_model_code: 'MC1', p_delta: 8 }])
    expect(stock.quantity('MC1')).toBe(13)
    // total capped: (in_stock 1 + min(10, 2)) × 100 = 300
    expect(activeClient.updatePayload('orders').total_amount).toBe(300)
  })

  test('REGLA (ADR-019): re-confirmar con el mismo valor es idempotente (delta 0)', async () => {
    const { client, stock } = receptionMock({
      persisted: { quantity_received: 10, quantity_to_order: 2 }, // excess 8 already applied
      inventory: { quantity: 13 },
    })
    activeClient = client
    const res = await confirm(10)
    expect(res.status).toBe(200)
    expect((await res.json()).inventory_updated).toBe(0)
    expect(stock.quantity('MC1')).toBe(13)
  })

  test('corrección a la baja resta el delta del inventario', async () => {
    const { client, stock } = receptionMock({
      persisted: { quantity_received: 10, quantity_to_order: 2 }, // previous excess 8
      inventory: { quantity: 13 },
    })
    activeClient = client
    const res = await confirm(4) // new excess 2 → delta −6
    expect(res.status).toBe(200)
    expect((await res.json()).warnings).toEqual([])
    expect(stock.quantity('MC1')).toBe(7)
  })

  test('corrección a la baja con stock insuficiente → clamp en 0 + warning', async () => {
    const { client, stock } = receptionMock({
      persisted: { quantity_received: 10, quantity_to_order: 2 }, // previous excess 8
      inventory: { quantity: 4 }, // part of it was already sold
    })
    activeClient = client
    const res = await confirm(2) // delta −8, 4 − 8 = −4 → 0
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(stock.quantity('MC1')).toBe(0)
    expect(body.warnings).toHaveLength(1)
    expect(body.warnings[0]).toMatch(/negativo/)
  })

  test('corrección a la baja sin fila de inventario → warning, sin crash', async () => {
    const { client, stock } = receptionMock({
      persisted: { quantity_received: 10, quantity_to_order: 2 },
      inventory: null, // the row does not exist
    })
    activeClient = client
    const res = await confirm(2)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warnings).toHaveLength(1)
    expect(body.inventory_updated).toBe(0)
    expect(stock.quantity('MC1')).toBeUndefined()
  })

  test('excedente sin fila de inventario → crea la fila con el excedente', async () => {
    const { client, stock } = receptionMock({
      persisted: { quantity_received: 0, quantity_to_order: 2 },
      inventory: null,
    })
    activeClient = client
    expect((await confirm(10)).status).toBe(200)
    expect(stock.quantity('MC1')).toBe(8)
  })

  test('separadores en el payload se ignoran (defensivo)', async () => {
    const { client } = receptionMock({
      persisted: { quantity_received: 0, quantity_to_order: 0, item_type: 'separator' },
    })
    activeClient = client
    const res = await confirm(10)
    expect(res.status).toBe(200)
    expect(activeClient.didCall('order_items', 'update')).toBe(false)
    expect(activeClient.rpcParams('adjust_inventory')).toEqual([])
  })

  test('ítem sin model_code: actualiza recepción pero no toca inventario', async () => {
    const { client } = receptionMock({
      persisted: { quantity_received: 0, quantity_to_order: 2, model_code: '  ' },
    })
    activeClient = client
    const res = await confirm(10)
    expect(res.status).toBe(200)
    expect(activeClient.didCall('order_items', 'update')).toBe(true)
    expect(activeClient.rpcParams('adjust_inventory')).toEqual([])
  })

  test('REGLA (#157): un ítem de OTRA orden → 400 y no escribe nada', async () => {
    const { client, stock } = receptionMock({
      persisted: { id: 'it1', quantity_received: 0, quantity_to_order: 2 },
      inventory: { quantity: 5 },
    })
    activeClient = client
    const res = await confirm(10, 'it-other-order')
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/no pertenece a esta orden/)
    const read = activeClient.callsTo('order_items', 'select')[0]
    expect(filterValue(read, 'order_id')).toBe('o1') // the read is scoped to the order in the URL
    expect(activeClient.didCall('order_items', 'update')).toBe(false)
    expect(stock.quantity('MC1')).toBe(5)
  })

  test('REGLA (#157): las escrituras de la recepción van acotadas a la orden', async () => {
    const { client } = receptionMock({ persisted: { quantity_received: 0, quantity_to_order: 2 } })
    activeClient = client
    expect((await confirm(2)).status).toBe(200)
    const update = activeClient.callsTo('order_items', 'update')[0]
    expect(filterValue(update, 'id')).toBe('it1')
    expect(filterValue(update, 'order_id')).toBe('o1')
  })

  test('REGLA (#157): una línea sin pedido a URREA (todo salió de stock) no lleva recepción → 400', async () => {
    const { client, stock } = receptionMock({
      persisted: { quantity_received: 0, quantity_to_order: 0 },
      inventory: { quantity: 5 },
    })
    activeClient = client
    const res = await confirm(4)
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/no se pidió a URREA/)
    expect(activeClient.didCall('order_items', 'update')).toBe(false)
    expect(stock.quantity('MC1')).toBe(5) // before #157 all 4 entered as "excess"
  })

  test('REGLA (#157): se valida todo el lote antes de la primera escritura', async () => {
    const { client, stock } = receptionMock({
      persisted: [
        { id: 'it1', quantity_received: 0, quantity_to_order: 2 },
        { id: 'it2', quantity_received: 0, quantity_to_order: 0 }, // invalid: no URREA order
      ],
      inventory: { quantity: 5 },
    })
    activeClient = client
    const res = await confirmReception.POST(
      makeRequest({ items: [
        { id: 'it1', quantity_received: 10, urrea_status: 'supplied' },
        { id: 'it2', quantity_received: 3, urrea_status: 'supplied' },
      ] }),
      makeParams({ id: 'o1' }),
    )
    expect(res.status).toBe(400)
    expect(activeClient.didCall('order_items', 'update')).toBe(false)
    expect(stock.quantity('MC1')).toBe(5)
  })

  test('400 con un producto repetido o un estado de envío inválido', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const repeated = await confirmReception.POST(
      makeRequest({ items: [
        { id: 'it1', quantity_received: 1, urrea_status: 'supplied' },
        { id: 'it1', quantity_received: 2, urrea_status: 'supplied' },
      ] }),
      makeParams({ id: 'o1' }),
    )
    expect(repeated.status).toBe(400)
    const badStatus = await confirmReception.POST(
      makeRequest({ items: [{ id: 'it1', quantity_received: 1, urrea_status: 'lost' }] }),
      makeParams({ id: 'o1' }),
    )
    expect(badStatus.status).toBe(400)
    expect(activeClient.didCall('order_items', 'update')).toBe(false)
  })
})
