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

  test('REGLA: constraint unit_price_check (precio negativo) → 400 con offendingEtm', async () => {
    // Nota: orders/create hace `quantity || 1` (fallback) → quantity=0 no llega a la BD.
    // El precio sí se preserva, así que probamos con precio negativo.
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'store_inventory.select': { data: null, error: null },
        'orders.insert': { data: { id: 'o1', customer_name: 'ACME' }, error: null },
        'order_items.insert': {
          data: null,
          error: {
            code: '23514',
            message: 'violates check constraint "order_items_unit_price_check"',
          },
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
        'order_items.select': { data: [{ model_code: 'MC1', quantity_in_stock: 3, quantity_received: 0, quantity_to_order: 0 }], error: null },
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
        'order_items.select': { data: [{ model_code: 'MC1', quantity_in_stock: 2, quantity_received: 1, quantity_to_order: 1 }], error: null },
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

  test('REGLA (ADR-019): cancelar tras recepción con excedente NO duplica el excedente', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'received' }, error: null },
        // recibió 10, pedía 1: los 9 de excedente YA entraron al confirmar recepción
        'order_items.select': { data: [{ model_code: 'MC1', quantity_in_stock: 2, quantity_received: 10, quantity_to_order: 1 }], error: null },
        'store_inventory.select': { data: { id: 'inv1', quantity: 4 }, error: null },
        'store_inventory.update': { data: null, error: null },
        'orders.update': { data: null, error: null },
      },
    })
    const res = await cancel.POST(makeRequest(), makeParams({ id: 'o1' }))
    expect(res.status).toBe(200)
    // restaura in_stock 2 + min(10, 1) = 3 → 4 + 3 = 7 (NO 4 + 12)
    expect(activeClient.updatePayload('store_inventory').quantity).toBe(7)
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

  // Fixture del ítem persistido, ANTES de la recepción que se está confirmando.
  // order_items.select se usa por-item (eq id) y al final (eq order_id) → ramificar por filtro.
  // hasFilter() busca por columna, no por posición: robusto a reordenamientos del handler.
  function receptionMock(opts: {
    persisted: { quantity_received: number; quantity_to_order: number; model_code?: string | null; item_type?: string }
    inventory?: { quantity: number } | null
    finalItems?: Record<string, unknown>[]
  }) {
    return createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'received' }, error: null },
        'order_items.select': (rec) => {
          if (hasFilter(rec, 'id')) {
            return {
              data: {
                model_code: opts.persisted.model_code === undefined ? 'MC1' : opts.persisted.model_code,
                etm: 'ETM1',
                item_type: opts.persisted.item_type ?? 'product',
                quantity_received: opts.persisted.quantity_received,
                quantity_to_order: opts.persisted.quantity_to_order,
              },
              error: null,
            }
          }
          return { data: opts.finalItems ?? [], error: null }
        },
        'order_items.update': { data: null, error: null },
        'store_inventory.select': {
          data: opts.inventory === null ? null : { id: 'inv1', quantity: opts.inventory?.quantity ?? 0 },
          error: null,
        },
        'store_inventory.update': { data: null, error: null },
        'store_inventory.insert': { data: null, error: null },
        'orders.update': { data: null, error: null },
      },
    })
  }

  const confirm = (quantity_received: number) =>
    confirmReception.POST(
      makeRequest({ items: [{ id: 'it1', quantity_received, urrea_status: 'supplied' }] }),
      makeParams({ id: 'o1' }),
    )

  test('400 si quantity_received es negativo o no entero', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await confirm(-1)).status).toBe(400)
    activeClient = createMockSupabase({ user: AUTH })
    expect((await confirm(1.5)).status).toBe(400)
  })

  test('REGLA (ADR-019): sin excedente NO toca inventario, solo actualiza el ítem y el total', async () => {
    activeClient = receptionMock({
      persisted: { quantity_received: 0, quantity_to_order: 3 },
      finalItems: [{ quantity_in_stock: 2, quantity_received: 3, quantity_to_order: 3, urrea_status: 'supplied', unit_price: 100, item_type: 'product' }],
    })
    const res = await confirm(3) // recibió exactamente lo pedido
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inventory_updated).toBe(0)
    expect(body.warnings).toEqual([])
    expect(activeClient.didCall('store_inventory', 'update')).toBe(false)
    expect(activeClient.didCall('store_inventory', 'insert')).toBe(false)

    // ítem actualizado y total recalculado: (2 + min(3,3)) × 100 = 500
    expect(activeClient.updatePayload('order_items').quantity_received).toBe(3)
    expect(activeClient.updatePayload('orders').total_amount).toBe(500)
  })

  test('REGLA (ADR-019): el excedente entra a inventario y NO se factura (10 recibidos, 2 pedidos → +8)', async () => {
    activeClient = receptionMock({
      persisted: { quantity_received: 0, quantity_to_order: 2 },
      inventory: { quantity: 5 },
      finalItems: [{ quantity_in_stock: 1, quantity_received: 10, quantity_to_order: 2, urrea_status: 'supplied', unit_price: 100, item_type: 'product' }],
    })
    const res = await confirm(10)
    expect(res.status).toBe(200)
    expect((await res.json()).inventory_updated).toBe(1)

    // inventario: 5 + excedente 8 = 13 (no 5 + 10)
    expect(activeClient.updatePayload('store_inventory').quantity).toBe(13)
    // total topado: (in_stock 1 + min(10, 2)) × 100 = 300
    expect(activeClient.updatePayload('orders').total_amount).toBe(300)
  })

  test('REGLA (ADR-019): re-confirmar con el mismo valor es idempotente (delta 0)', async () => {
    activeClient = receptionMock({
      persisted: { quantity_received: 10, quantity_to_order: 2 }, // excedente 8 ya aplicado
      inventory: { quantity: 13 },
    })
    const res = await confirm(10)
    expect(res.status).toBe(200)
    expect((await res.json()).inventory_updated).toBe(0)
    expect(activeClient.didCall('store_inventory', 'update')).toBe(false)
  })

  test('corrección a la baja resta el delta del inventario', async () => {
    activeClient = receptionMock({
      persisted: { quantity_received: 10, quantity_to_order: 2 }, // excedente previo 8
      inventory: { quantity: 13 },
    })
    const res = await confirm(4) // excedente nuevo 2 → delta −6
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warnings).toEqual([])
    expect(activeClient.updatePayload('store_inventory').quantity).toBe(7)
  })

  test('corrección a la baja con stock insuficiente → clamp en 0 + warning', async () => {
    activeClient = receptionMock({
      persisted: { quantity_received: 10, quantity_to_order: 2 }, // excedente previo 8
      inventory: { quantity: 4 }, // ya se vendió parte
    })
    const res = await confirm(2) // delta −8, 4 − 8 = −4 → 0
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(activeClient.updatePayload('store_inventory').quantity).toBe(0)
    expect(body.warnings).toHaveLength(1)
    expect(body.warnings[0]).toMatch(/negativo/)
  })

  test('corrección a la baja sin fila de inventario → warning, sin crash', async () => {
    activeClient = receptionMock({
      persisted: { quantity_received: 10, quantity_to_order: 2 },
      inventory: null, // la fila no existe
    })
    const res = await confirm(2)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warnings).toHaveLength(1)
    expect(activeClient.didCall('store_inventory', 'update')).toBe(false)
    expect(activeClient.didCall('store_inventory', 'insert')).toBe(false)
  })

  test('excedente sin fila de inventario → crea la fila con el excedente', async () => {
    activeClient = receptionMock({
      persisted: { quantity_received: 0, quantity_to_order: 2 },
      inventory: null,
    })
    const res = await confirm(10)
    expect(res.status).toBe(200)
    const ins = activeClient.insertPayload<Record<string, unknown>>('store_inventory')
    expect(ins).toEqual({ model_code: 'MC1', quantity: 8 })
  })

  test('separadores en el payload se ignoran (defensivo)', async () => {
    activeClient = receptionMock({
      persisted: { quantity_received: 0, quantity_to_order: 0, item_type: 'separator' },
    })
    const res = await confirm(10)
    expect(res.status).toBe(200)
    expect(activeClient.didCall('order_items', 'update')).toBe(false)
    expect(activeClient.didCall('store_inventory', 'insert')).toBe(false)
  })

  test('ítem sin model_code: actualiza recepción pero no toca inventario', async () => {
    activeClient = receptionMock({
      persisted: { quantity_received: 0, quantity_to_order: 2, model_code: '  ' },
    })
    const res = await confirm(10)
    expect(res.status).toBe(200)
    expect(activeClient.didCall('order_items', 'update')).toBe(true)
    expect(activeClient.didCall('store_inventory', 'insert')).toBe(false)
  })
})
