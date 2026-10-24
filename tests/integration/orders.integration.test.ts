/**
 * Orders against local Supabase (ADR-021): inventory split on create,
 * reception excess (ADR-019), inventory restore on cancel and the
 * quotation ↔ order link (ADR-010).
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import { authedClient } from './helpers/clients'
import { LOCAL, resetDb, sql, seedQuotation, closePool } from './helpers/db'
import * as createOrder from '@/app/api/quotations/[id]/create-order/route'
import * as reception from '@/app/api/orders/[id]/confirm-reception/route'
import * as cancel from '@/app/api/orders/[id]/cancel/route'
import * as orderRoute from '@/app/api/orders/[id]/route'
import * as orderStatus from '@/app/api/orders/[id]/status/route'
import * as orderItems from '@/app/api/orders/[id]/items/route'
import * as orderItem from '@/app/api/orders/[id]/items/[itemId]/route'
import * as quotationRoute from '@/app/api/quotations/[id]/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

beforeAll(async () => { activeClient = await authedClient() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

/** Approved quotation: 60001 (stock 5) qty 12, an approved not-sold item and a separator. */
async function approvedQuotation() {
  return seedQuotation({
    status: 'approved',
    items: [
      { item_type: 'separator', section_label: 'Sec A' },
      { etm: 'P1', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 12, is_approved: true, is_sold: true },
      { etm: 'NO', model_code: '60004', brand: 'URREA', unit_price: 5, quantity: 2, is_approved: true, is_sold: false },
    ],
  })
}

const createFromQuote = (id: string) =>
  createOrder.POST(makeRequest(undefined, { method: 'POST' }), makeParams({ id }))

describe('create-order → split de inventario (integración local)', () => {
  test('divide stock (5) vs a pedir (7), guarda gaveta, excluye no-sell y deduce inventario', async () => {
    const { id } = await approvedQuotation()

    const res = await createFromQuote(id)
    expect(res.status).toBe(200)
    const { order_id } = await readJson<{ order_id: string }>(res)

    const [p1] = await sql<{ quantity_in_stock: number; quantity_to_order: number; location: string | null }>(
      "SELECT quantity_in_stock, quantity_to_order, location FROM order_items WHERE order_id = $1 AND etm = 'P1'",
      [order_id],
    )
    expect(p1).toMatchObject({ quantity_in_stock: 5, quantity_to_order: 7, location: 'Gaveta S1' })

    // Not-sold stays out of the order; the separator goes in.
    expect(await sql("SELECT 1 FROM order_items WHERE order_id = $1 AND etm = 'NO'", [order_id])).toHaveLength(0)
    expect(await sql("SELECT 1 FROM order_items WHERE order_id = $1 AND item_type = 'separator'", [order_id])).toHaveLength(1)

    const [inv] = await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'")
    expect(inv.quantity).toBe(0)

    const [q] = await sql<{ status: string }>('SELECT status FROM quotations WHERE id = $1', [id])
    expect(q.status).toBe('converted_to_order')
  })

  test('cotización no aprobada → 400', async () => {
    const { id } = await seedQuotation({ status: 'draft', items: [{ etm: 'A', quantity: 1, unit_price: 1, is_approved: true }] })
    expect((await createFromQuote(id)).status).toBe(400)
  })
})

describe('confirm-reception → excedente al inventario (ADR-019, integración local)', () => {
  test('recibir más de lo pedido: solo el excedente entra; idempotente; corrección a la baja resta', async () => {
    const { id } = await approvedQuotation()
    const { order_id } = await readJson<{ order_id: string }>(await createFromQuote(id))
    const [item] = await sql<{ id: string }>("SELECT id FROM order_items WHERE order_id = $1 AND etm = 'P1'", [order_id])

    const confirm = (received: number) =>
      reception.POST(
        makeRequest({ items: [{ id: item.id, quantity_received: received, urrea_status: 'supplied' }] }, { method: 'POST' }),
        makeParams({ id: order_id }),
      )
    const stock = async () =>
      Number((await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'"))[0].quantity)

    // 7 ordered, 10 arrive → excess 3 to inventory (0 after the split).
    expect((await confirm(10)).status).toBe(200)
    expect(await stock()).toBe(3)

    // Re-confirming the SAME number → delta 0 → idempotent.
    expect((await confirm(10)).status).toBe(200)
    expect(await stock()).toBe(3)

    // Correcting down to what was ordered → excess 0 → subtracts the 3.
    expect((await confirm(7)).status).toBe(200)
    expect(await stock()).toBe(0)
  })

  test('recibir ≤ lo pedido NO mueve inventario', async () => {
    const { id } = await approvedQuotation()
    const { order_id } = await readJson<{ order_id: string }>(await createFromQuote(id))
    const [item] = await sql<{ id: string }>("SELECT id FROM order_items WHERE order_id = $1 AND etm = 'P1'", [order_id])

    const res = await reception.POST(
      makeRequest({ items: [{ id: item.id, quantity_received: 5, urrea_status: 'supplied' }] }, { method: 'POST' }),
      makeParams({ id: order_id }),
    )
    expect(res.status).toBe(200)
    const [inv] = await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'")
    expect(inv.quantity).toBe(0) // still 0: what was ordered is the customer's, not stock
  })
})

describe('cancel → restaura inventario (integración local)', () => {
  test('cancelar una orden recién creada restaura el stock reservado', async () => {
    const { id } = await approvedQuotation()
    const { order_id } = await readJson<{ order_id: string }>(await createFromQuote(id))
    // After the split inventory sits at 0 (5 reserved).
    expect(Number((await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'"))[0].quantity)).toBe(0)

    const res = await cancel.POST(makeRequest(undefined, { method: 'POST' }), makeParams({ id: order_id }))
    expect(res.status).toBe(200)

    // in_stock (5) + min(received 0, ordered 7) = 0 → restores 5.
    const [inv] = await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'")
    expect(inv.quantity).toBe(5)
    const [o] = await sql<{ status: string }>('SELECT status FROM orders WHERE id = $1', [order_id])
    expect(o.status).toBe('cancelled')
  })
})

describe('vínculo cotización ↔ orden (ADR-010, integración local)', () => {
  const stock = async () =>
    Number((await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'"))[0].quantity)
  const deleteQuotation = (id: string) =>
    quotationRoute.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id }))

  test('create-order guarda quotation_id en la orden', async () => {
    const { id } = await approvedQuotation()
    const { order_id } = await readJson<{ order_id: string }>(await createFromQuote(id))
    const [o] = await sql<{ quotation_id: string | null }>('SELECT quotation_id FROM orders WHERE id = $1', [order_id])
    expect(o.quotation_id).toBe(id)
  })

  test('el índice único rechaza una segunda orden ligada a la misma cotización; las manuales (NULL) no chocan', async () => {
    const { id } = await approvedQuotation()
    const insert = (quotationId: string | null) =>
      sql("INSERT INTO orders (name, customer_name, status, total_amount, quotation_id) VALUES ('O','ACME','ordered',0,$1)", [quotationId])

    await insert(id)
    await expect(insert(id)).rejects.toThrow(/orders_quotation_id_unique/)

    await insert(null)
    await insert(null)
    expect(await sql('SELECT 1 FROM orders WHERE quotation_id IS NULL')).toHaveLength(2)
  })

  test('si la cotización vuelve a approved con la orden viva (doble clic), la segunda orden es 400 y no deduce stock otra vez', async () => {
    const { id } = await approvedQuotation()
    expect((await createFromQuote(id)).status).toBe(200)
    expect(await stock()).toBe(0) // 5 reserved by the first order

    // Simulates the race: the second request read status 'approved' before the first one finished.
    await sql("UPDATE quotations SET status = 'approved' WHERE id = $1", [id])
    await sql("UPDATE store_inventory SET quantity = 5 WHERE model_code = '60001'")

    const res = await createFromQuote(id)
    expect(res.status).toBe(400)
    expect((await readJson<{ message: string }>(res)).message).toMatch(/ya tiene una orden/i)
    expect(await sql('SELECT 1 FROM orders WHERE quotation_id = $1', [id])).toHaveLength(1)
    expect(await stock()).toBe(5) // the losing request never reached the deduction
  })

  test('eliminar la cotización con su orden viva → 400 y no borra nada; sin la orden se elimina con sus ítems', async () => {
    const { id } = await approvedQuotation()
    const { order_id } = await readJson<{ order_id: string }>(await createFromQuote(id))

    const blocked = await deleteQuotation(id)
    expect(blocked.status).toBe(400)
    expect((await readJson<{ message: string }>(blocked)).message).toMatch(/elimina la orden vinculada/i)
    expect(await sql('SELECT 1 FROM quotations WHERE id = $1', [id])).toHaveLength(1)
    expect(await sql('SELECT 1 FROM quotation_items WHERE quotation_id = $1', [id])).toHaveLength(3)

    expect((await orderRoute.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: order_id }))).status).toBe(200)

    expect((await deleteQuotation(id)).status).toBe(200)
    expect(await sql('SELECT 1 FROM quotations WHERE id = $1', [id])).toHaveLength(0)
    expect(await sql('SELECT 1 FROM quotation_items WHERE quotation_id = $1', [id])).toHaveLength(0)
  })

  test('cancelar y luego eliminar la orden (el camino que pide la guarda) no restaura el stock dos veces', async () => {
    const { id } = await approvedQuotation()
    const { order_id } = await readJson<{ order_id: string }>(await createFromQuote(id))
    expect(await stock()).toBe(0)

    expect((await cancel.POST(makeRequest(undefined, { method: 'POST' }), makeParams({ id: order_id }))).status).toBe(200)
    expect(await stock()).toBe(5)

    // A cancelled order still blocks: the guard asks to delete it.
    expect((await deleteQuotation(id)).status).toBe(400)

    expect((await orderRoute.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: order_id }))).status).toBe(200)
    expect(await stock()).toBe(5) // NOT 10: cancel already returned those 5
    expect(await sql('SELECT 1 FROM orders WHERE id = $1', [order_id])).toHaveLength(0)

    expect((await deleteQuotation(id)).status).toBe(200)
  })
})

// ─── #157: atomic stock ─────────────────────────────────────────────────────

const stockOf = async (code = '60001') =>
  (await sql<{ quantity: number }>('SELECT quantity FROM store_inventory WHERE model_code = $1', [code]))
    .map((r) => Number(r.quantity))[0]

const rpc = async (fn: string, params: Record<string, unknown>) => {
  const { data, error } = await activeClient.rpc(fn, params)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as unknown
}

describe('funciones atómicas de stock (#157, integración local)', () => {
  test('reserve_inventory suma códigos repetidos, aparta least(stock, pedido) y regresa la gaveta', async () => {
    const result = await rpc('reserve_inventory', {
      p_lines: [
        { model_code: '60001', quantity: 3 },
        { model_code: '60001', quantity: 4 },
        { model_code: 'NO-EXISTE', quantity: 2 },
      ],
    })
    expect(result).toEqual([
      { model_code: '60001', reserved: 5, location: 'Gaveta S1' },
      { model_code: 'NO-EXISTE', reserved: 0, location: null },
    ])
    expect(await stockOf()).toBe(0)
    expect(await stockOf('NO-EXISTE')).toBeUndefined() // reserving never creates rows
  })

  test('release_inventory suma y crea la fila que falta; adjust_inventory topa en 0 y avisa', async () => {
    expect(await rpc('release_inventory', {
      p_lines: [{ model_code: '60001', quantity: 2 }, { model_code: 'NUEVO', quantity: 3 }, { model_code: 'NUEVO', quantity: 1 }],
    })).toBe(2)
    expect(await stockOf()).toBe(7)
    expect(await stockOf('NUEVO')).toBe(4)

    expect(await rpc('adjust_inventory', { p_model_code: '60001', p_delta: -10 })).toEqual({ quantity: 0, clamped: true, missing: false })
    expect(await rpc('adjust_inventory', { p_model_code: 'FALTA', p_delta: -1 })).toEqual({ quantity: null, clamped: false, missing: true })
    expect(await rpc('adjust_inventory', { p_model_code: 'FALTA', p_delta: 2 })).toEqual({ quantity: 2, clamped: false, missing: false })
  })

  test('REGLA: anon no puede ejecutarlas (solo authenticated)', async () => {
    const anon = createClient(LOCAL.url, LOCAL.anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await anon.rpc('reserve_inventory', { p_lines: [{ model_code: '60001', quantity: 1 }] })
    expect(error).not.toBeNull()
    expect(await stockOf()).toBe(5)
  })

  test('REGLA: dos apartados simultáneos del mismo código nunca reparten más de lo que hay', async () => {
    const takes = await Promise.all(
      Array.from({ length: 4 }, () => rpc('reserve_inventory', { p_lines: [{ model_code: '60001', quantity: 2 }] })),
    )
    const reserved = takes.flatMap((t) => t as { reserved: number }[]).reduce((sum, r) => sum + r.reserved, 0)
    expect(reserved).toBe(5)
    expect(await stockOf()).toBe(0)
  })
})

describe('órdenes con stock atómico (#157, integración local)', () => {
  const createdOrder = async (items: Parameters<typeof seedQuotation>[0]['items']) => {
    const { id } = await seedQuotation({ status: 'approved', items })
    const res = await createFromQuote(id)
    expect(res.status).toBe(200)
    return (await readJson<{ order_id: string }>(res)).order_id
  }
  const lines = (orderId: string) =>
    sql<{ id: string; etm: string; quantity_in_stock: number; quantity_to_order: number }>(
      "SELECT id, etm, quantity_in_stock, quantity_to_order FROM order_items WHERE order_id = $1 AND item_type = 'product' ORDER BY sort_order",
      [orderId],
    )
  const cancelOrder = (id: string) => cancel.POST(makeRequest(undefined, { method: 'POST' }), makeParams({ id }))
  const deleteOrder = (id: string) => orderRoute.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id }))

  test('REGLA: el mismo model_code en dos secciones se aparta contra un solo stock (5 → 3 + 2)', async () => {
    const orderId = await createdOrder([
      { item_type: 'separator', section_label: 'A' },
      { etm: 'A1', model_code: '60001', brand: 'URREA', unit_price: 10, quantity: 3, is_approved: true },
      { item_type: 'separator', section_label: 'B' },
      { etm: 'B1', model_code: '60001', brand: 'URREA', unit_price: 10, quantity: 3, is_approved: true },
    ])
    expect((await lines(orderId)).map((l) => [l.etm, l.quantity_in_stock, l.quantity_to_order])).toEqual([
      ['A1', 3, 0],
      ['B1', 2, 1],
    ])
    expect(await stockOf()).toBe(0)
  })

  test('REGLA: dos órdenes creadas a la vez no apartan más de lo que hay', async () => {
    const quotes = await Promise.all([1, 2].map(() => seedQuotation({
      status: 'approved',
      items: [{ etm: 'P', model_code: '60001', brand: 'URREA', unit_price: 10, quantity: 4, is_approved: true }],
    })))
    const results = await Promise.all(quotes.map((q) => createFromQuote(q.id)))
    expect(results.map((r) => r.status)).toEqual([200, 200])
    const [{ total }] = await sql<{ total: string }>(
      "SELECT sum(quantity_in_stock) AS total FROM order_items WHERE model_code = '60001'",
    )
    expect(Number(total)).toBe(5) // 4 + 1, never 4 + 4
    expect(await stockOf()).toBe(0)
  })

  test('REGLA: cancelar dos veces a la vez devuelve el stock UNA vez', async () => {
    const orderId = await createdOrder([{ etm: 'P', model_code: '60001', brand: 'URREA', unit_price: 10, quantity: 4, is_approved: true }])
    expect(await stockOf()).toBe(1)
    const statuses = (await Promise.all([cancelOrder(orderId), cancelOrder(orderId)])).map((r) => r.status).sort()
    expect(statuses[0]).toBe(200)
    expect([400, 409]).toContain(statuses[1])
    expect(await stockOf()).toBe(5) // 1 + 4, not 9
  })

  test('REGLA: eliminar dos veces a la vez devuelve el stock UNA vez', async () => {
    const orderId = await createdOrder([{ etm: 'P', model_code: '60001', brand: 'URREA', unit_price: 10, quantity: 4, is_approved: true }])
    const statuses = (await Promise.all([deleteOrder(orderId), deleteOrder(orderId)])).map((r) => r.status).sort()
    expect(statuses[0]).toBe(200)
    expect([404, 409]).toContain(statuses[1])
    expect(await stockOf()).toBe(5)
    expect(await sql('SELECT 1 FROM orders WHERE id = $1', [orderId])).toHaveLength(0)
  })

  test('REGLA: cancelar mientras se quita una línea nunca devuelve esa línea dos veces', async () => {
    for (let round = 0; round < 3; round++) {
      await sql("UPDATE store_inventory SET quantity = 5 WHERE model_code = '60001'")
      const orderId = await createdOrder([
        { etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 10, quantity: 2, is_approved: true },
        { etm: 'B', model_code: '60001', brand: 'URREA', unit_price: 10, quantity: 2, is_approved: true },
      ])
      expect(await stockOf()).toBe(1)
      const [, lineB] = await lines(orderId)

      // Before the fix cancel read the lines outside its transaction, so B could come back twice (7).
      await Promise.all([
        cancelOrder(orderId),
        orderItem.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: orderId, itemId: lineB.id })),
      ])
      expect(await stockOf(), `ronda ${round}`).toBe(5)
    }
  })

  test('REGLA: una orden entregada no se cancela ni pierde líneas; el stock no se mueve', async () => {
    const orderId = await createdOrder([{ etm: 'P', model_code: '60001', brand: 'URREA', unit_price: 10, quantity: 4, is_approved: true }])
    await sql("UPDATE orders SET status = 'delivered' WHERE id = $1", [orderId])
    const [line] = await lines(orderId)

    expect((await cancelOrder(orderId)).status).toBe(400)
    const removed = await orderItem.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: orderId, itemId: line.id }))
    expect(removed.status).toBe(400)
    const added = await orderItems.POST(
      makeRequest({ etm: 'X', model_code: '60001', description: 'X', brand: 'URREA', unit_price: 1, quantity_approved: 1 }),
      makeParams({ id: orderId }),
    )
    expect(added.status).toBe(400)

    expect(await stockOf()).toBe(1)
    const [o] = await sql<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId])
    expect(o.status).toBe('delivered')
    expect(await lines(orderId)).toHaveLength(1)
  })

  test('agregar y quitar una línea aparta y devuelve contra el stock real', async () => {
    const orderId = await createdOrder([{ etm: 'P', model_code: '60001', brand: 'URREA', unit_price: 10, quantity: 2, is_approved: true }])
    expect(await stockOf()).toBe(3)

    const added = await orderItems.POST(
      makeRequest({ etm: 'X', model_code: '60001', description: 'X', brand: 'URREA', unit_price: 5, quantity_approved: 4 }),
      makeParams({ id: orderId }),
    )
    expect(added.status).toBe(200)
    const { item } = await readJson<{ item: { id: string; quantity_in_stock: number; quantity_to_order: number } }>(added)
    expect([item.quantity_in_stock, item.quantity_to_order]).toEqual([3, 1])
    expect(await stockOf()).toBe(0)

    const removed = await orderItem.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: orderId, itemId: item.id }))
    expect(removed.status).toBe(200)
    expect(await stockOf()).toBe(3)
    // A retry finds no line and returns nothing twice.
    const again = await orderItem.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: orderId, itemId: item.id }))
    expect(again.status).toBe(404)
    expect(await stockOf()).toBe(3)
  })

  test('REGLA: la recepción rechaza líneas de OTRA orden y líneas sin pedido a URREA, sin escribir nada', async () => {
    // Order A: 12 of 60001 → 5 from stock, 7 to order. Order B: a line fully covered by stock.
    const { id: qa } = await approvedQuotation()
    const orderA = (await readJson<{ order_id: string }>(await createFromQuote(qa))).order_id
    await sql("UPDATE store_inventory SET quantity = 10 WHERE model_code = '60001'")
    const orderB = await createdOrder([{ etm: 'S', model_code: '60001', brand: 'URREA', unit_price: 10, quantity: 2, is_approved: true }])
    const [lineA] = await lines(orderA)
    const [lineB] = await lines(orderB)
    expect(lineB.quantity_to_order).toBe(0)

    const receive = (orderId: string, itemId: string, received: number) =>
      reception.POST(
        makeRequest({ items: [{ id: itemId, quantity_received: received, urrea_status: 'supplied' }] }, { method: 'POST' }),
        makeParams({ id: orderId }),
      )

    // A line of order A sent through order B's URL.
    expect((await receive(orderB, lineA.id, 9)).status).toBe(400)
    // A line with nothing ordered from URREA: before #157 all of it entered as "excess".
    expect((await receive(orderB, lineB.id, 4)).status).toBe(400)

    const received = await sql<{ quantity_received: number }>(
      'SELECT quantity_received FROM order_items WHERE id = ANY($1)',
      [[lineA.id, lineB.id]],
    )
    expect(received.map((r) => Number(r.quantity_received))).toEqual([0, 0])
    expect(await stockOf()).toBe(8)
  })

  test('REGLA: la recepción es todo o nada (una línea inválida deshace lo ya escrito del lote)', async () => {
    await sql("INSERT INTO store_inventory (model_code, quantity) VALUES ('ZZ999', 10)")
    const orderId = await createdOrder([
      { etm: 'P1', model_code: '60001', brand: 'URREA', unit_price: 10, quantity: 12, is_approved: true },
      { etm: 'P2', model_code: 'ZZ999', brand: 'URREA', unit_price: 10, quantity: 2, is_approved: true },
    ])
    const [p1, p2] = await lines(orderId)
    expect([p1.quantity_to_order, p2.quantity_to_order]).toEqual([7, 0])

    // 60001 sorts first, so its line and its +3 excess are written before ZZ999 fails.
    const res = await reception.POST(
      makeRequest({ items: [
        { id: p1.id, quantity_received: 10, urrea_status: 'supplied' },
        { id: p2.id, quantity_received: 3, urrea_status: 'supplied' },
      ] }, { method: 'POST' }),
      makeParams({ id: orderId }),
    )
    expect(res.status).toBe(400)
    expect((await readJson<{ message: string }>(res)).message).toMatch(/^P2: no se pidió a URREA/)

    const [{ quantity_received }] = await sql<{ quantity_received: number }>(
      'SELECT quantity_received FROM order_items WHERE id = $1', [p1.id],
    )
    expect(Number(quantity_received)).toBe(0)
    expect(await stockOf()).toBe(0)
    expect(await stockOf('ZZ999')).toBe(8)
  })

  test('REGLA: dos recepciones simultáneas de la misma línea no duplican el excedente', async () => {
    const { id } = await approvedQuotation()
    const orderId = (await readJson<{ order_id: string }>(await createFromQuote(id))).order_id
    const [line] = await lines(orderId)
    const receive = () =>
      reception.POST(
        makeRequest({ items: [{ id: line.id, quantity_received: 10, urrea_status: 'supplied' }] }, { method: 'POST' }),
        makeParams({ id: orderId }),
      )
    const statuses = (await Promise.all([receive(), receive()])).map((r) => r.status)
    expect(statuses).toEqual([200, 200])
    expect(await stockOf()).toBe(3) // 7 ordered, 10 received → +3 once, not +6
  })

  test('REGLA: una orden entregada no regresa a Pedida ni a Recibida', async () => {
    const orderId = await createdOrder([{ etm: 'P', model_code: '60001', brand: 'URREA', unit_price: 10, quantity: 4, is_approved: true }])
    await sql("UPDATE orders SET status = 'delivered' WHERE id = $1", [orderId])
    const patch = (status: string) =>
      orderStatus.PATCH(makeRequest({ status }, { method: 'PATCH' }), makeParams({ id: orderId }))

    expect((await patch('received')).status).toBe(400)
    expect((await patch('completed')).status).toBe(200)
    expect((await patch('delivered')).status).toBe(200)
    const [o] = await sql<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId])
    expect(o.status).toBe('delivered')
  })
})
