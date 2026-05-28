/**
 * Fase 3 — Órdenes.
 *
 * Cubre los flujos críticos de órdenes:
 *   - create:            validación, allocateInventory, deduce stock al CREAR, rollback.
 *   - [id] PATCH:        actualiza odoo_id, 404, 400 sin cambios.
 *   - [id] DELETE:       restaura inventario + borra items y orden.
 *   - [id]/cancel:       guardas de estado, restaura inventario, marca cancelled.
 *   - [id]/confirm-reception: actualiza items, suma a inventario, recalcula total.
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, hasFilter } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH, orderProduct } from '../helpers/factories'
import { makeRequest, makeParams } from '../helpers/request'
import * as create from '@/app/api/orders/create/route'
import * as orderById from '@/app/api/orders/[id]/route'
import * as cancel from '@/app/api/orders/[id]/cancel/route'
import * as confirmReception from '@/app/api/orders/[id]/confirm-reception/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

// ─── orders/create ───────────────────────────────────────────────────────

describe('POST /orders/create', () => {
  test('400 sin customer_name o sin productos', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await create.POST(makeRequest({ customer_name: '', products: [] }))).status).toBe(400)
    expect((await create.POST(makeRequest({ customer_name: 'ACME', products: [] }))).status).toBe(400)
  })

  test('REGLA: deduce stock al crear cuando hay inventario suficiente', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'store_inventory.select': { data: { id: 'inv1', quantity: 10 }, error: null },
        'orders.insert': { data: { id: 'o1', customer_name: 'ACME' }, error: null },
        'order_items.insert': { data: null, error: null },
        'store_inventory.update': { data: null, error: null },
      },
    })
    const res = await create.POST(makeRequest({
      customer_name: 'ACME',
      products: [orderProduct({ quantity: 4, price: 100 })],
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order_id).toBe('o1')
    expect(body.total_amount).toBe(400)        // 100 * 4
    expect(body.items_to_order).toBe(0)         // stock cubre todo
    expect(body.inventory_updated).toBe(1)

    // se descontó stock: 10 - 4 = 6
    const upd = activeClient.updatePayload('store_inventory')
    expect(upd.quantity).toBe(6)

    const items = activeClient.insertPayload('order_items')
    expect(items[0].quantity_in_stock).toBe(4)
    expect(items[0].quantity_to_order).toBe(0)
  })

  test('REGLA: allocateInventory divide stock/pedido cuando es parcial', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'store_inventory.select': { data: { id: 'inv1', quantity: 3 }, error: null },
        'orders.insert': { data: { id: 'o1', customer_name: 'ACME' }, error: null },
        'order_items.insert': { data: null, error: null },
        'store_inventory.update': { data: null, error: null },
      },
    })
    const res = await create.POST(makeRequest({
      customer_name: 'ACME',
      products: [orderProduct({ quantity: 10, price: 50 })],
    }))
    const body = await res.json()
    expect(body.items_to_order).toBe(1)
    const items = activeClient.insertPayload('order_items')
    expect(items[0].quantity_in_stock).toBe(3)
    expect(items[0].quantity_to_order).toBe(7)   // 10 - 3
    // invariante in_stock + to_order = approved
    expect((items[0].quantity_in_stock as number) + (items[0].quantity_to_order as number)).toBe(10)
  })

  test('REGLA: rollback — si falla insert de order_items, borra la orden', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'store_inventory.select': { data: { id: 'inv1', quantity: 10 }, error: null },
        'orders.insert': { data: { id: 'o1', customer_name: 'ACME' }, error: null },
        'order_items.insert': { data: null, error: { message: 'fail' } },
      },
    })
    const res = await create.POST(makeRequest({
      customer_name: 'ACME',
      products: [orderProduct({ quantity: 1, price: 10 })],
    }))
    expect(res.status).toBe(500)
    expect(activeClient.didCall('orders', 'delete')).toBe(true)
    // garantía de rollback: el stock NO se descontó (el fallo ocurre antes del update de inventario)
    expect(activeClient.didCall('store_inventory', 'update')).toBe(false)
  })
})

// ─── orders/[id] PATCH (odoo_id) ──────────────────────────────────────────

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

// ─── orders/[id] DELETE ────────────────────────────────────────────────────

describe('DELETE /orders/[id]', () => {
  test('404 si la orden no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: null, error: null } },
    })
    const res = await orderById.DELETE(makeRequest(), makeParams({ id: 'o1' }))
    expect(res.status).toBe(404)
  })

  test('REGLA: restaura inventario y borra items + orden', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1' }, error: null },
        // restoreOrderInventory lee order_items
        'order_items.select': { data: [{ model_code: 'MC1', quantity_in_stock: 3, quantity_received: 0 }], error: null },
        'store_inventory.select': { data: { id: 'inv1', quantity: 5 }, error: null },
        'store_inventory.update': { data: null, error: null },
        'order_items.delete': { data: null, error: null },
        'orders.delete': { data: null, error: null },
      },
    })
    const res = await orderById.DELETE(makeRequest(), makeParams({ id: 'o1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    // restauró stock: 5 + 3 = 8
    const upd = activeClient.updatePayload('store_inventory')
    expect(upd.quantity).toBe(8)
    expect(activeClient.didCall('order_items', 'delete')).toBe(true)
    expect(activeClient.didCall('orders', 'delete')).toBe(true)
  })
})

// ─── orders/[id]/cancel ────────────────────────────────────────────────────

describe('POST /orders/[id]/cancel', () => {
  test('404 si no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: null, error: null } },
    })
    expect((await cancel.POST(makeRequest(), makeParams({ id: 'o1' }))).status).toBe(404)
  })

  test('400 si ya está cancelada', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: { id: 'o1', status: 'cancelled' }, error: null } },
    })
    expect((await cancel.POST(makeRequest(), makeParams({ id: 'o1' }))).status).toBe(400)
  })

  test('400 si está completada', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: { id: 'o1', status: 'completed' }, error: null } },
    })
    expect((await cancel.POST(makeRequest(), makeParams({ id: 'o1' }))).status).toBe(400)
  })

  test('REGLA: cancela y restaura inventario', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null },
        'order_items.select': { data: [{ model_code: 'MC1', quantity_in_stock: 2, quantity_received: 1 }], error: null },
        'store_inventory.select': { data: { id: 'inv1', quantity: 4 }, error: null },
        'store_inventory.update': { data: null, error: null },
        'orders.update': { data: null, error: null },
      },
    })
    const res = await cancel.POST(makeRequest(), makeParams({ id: 'o1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.inventory_restored).toBe(1)
    // restauró 4 + (2+1) = 7
    const upd = activeClient.updatePayload('store_inventory')
    expect(upd.quantity).toBe(7)
    const ordUpd = activeClient.updatePayload('orders')
    expect(ordUpd.status).toBe('cancelled')
  })
})

// ─── orders/[id]/confirm-reception ─────────────────────────────────────────

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

  test('REGLA: actualiza items, suma a inventario y recalcula total', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'received' }, error: null },
        // order_items.select se usa por-item (eq id) y al final (eq order_id) → ramificar por filtro.
        // hasFilter() busca por columna, no por posición: robusto a reordenamientos del handler.
        'order_items.select': (rec) => {
          if (hasFilter(rec, 'id')) return { data: { model_code: 'MC1' }, error: null }
          // final: lista para calculateDeliveredTotal
          return {
            data: [{ quantity_in_stock: 2, quantity_received: 3, urrea_status: 'supplied', unit_price: 100, item_type: 'product' }],
            error: null,
          }
        },
        'order_items.update': { data: null, error: null },
        'store_inventory.select': { data: { id: 'inv1', quantity: 5 }, error: null },
        'store_inventory.update': { data: null, error: null },
        'orders.update': { data: null, error: null },
      },
    })
    const res = await confirmReception.POST(
      makeRequest({ items: [{ id: 'it1', quantity_received: 3, urrea_status: 'supplied' }] }),
      makeParams({ id: 'o1' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inventory_updated).toBe(1)

    // sumó al inventario existente: 5 + 3 = 8
    const invUpd = activeClient.updatePayload('store_inventory')
    expect(invUpd.quantity).toBe(8)

    // recalculó total: (in_stock 2 + received 3) * 100 = 500
    const ordUpd = activeClient.updatePayload('orders')
    expect(ordUpd.total_amount).toBe(500)
  })
})
