/**
 * Integración (Fase C1 · capa 4 — órdenes) contra el Supabase LOCAL.
 * El núcleo transaccional: split de inventario al crear la orden, recepción con
 * excedente (ADR-019: delta idempotente, cobro topado) y restauración al cancelar.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import { authedClient } from './helpers/clients'
import { resetDb, sql, seedQuotation, closePool } from './helpers/db'
import * as createOrder from '@/app/api/quotations/[id]/create-order/route'
import * as reception from '@/app/api/orders/[id]/confirm-reception/route'
import * as cancel from '@/app/api/orders/[id]/cancel/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

beforeAll(async () => { activeClient = await authedClient() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

/**
 * Cotización APROBADA estándar: 60001 (stock 5) aprobado qty 12, un "no lo
 * vendemos" aprobado (debe excluirse) y un separador. Devuelve su id.
 */
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

    // El producto aprobado se dividió con el stock real (allocateInventory).
    const [p1] = await sql<{ quantity_in_stock: number; quantity_to_order: number; location: string | null }>(
      "SELECT quantity_in_stock, quantity_to_order, location FROM order_items WHERE order_id = $1 AND etm = 'P1'",
      [order_id],
    )
    expect(p1).toMatchObject({ quantity_in_stock: 5, quantity_to_order: 7, location: 'Gaveta S1' })

    // "No lo vendemos" NO entra a la orden; el separador SÍ.
    expect(await sql("SELECT 1 FROM order_items WHERE order_id = $1 AND etm = 'NO'", [order_id])).toHaveLength(0)
    expect(await sql("SELECT 1 FROM order_items WHERE order_id = $1 AND item_type = 'separator'", [order_id])).toHaveLength(1)

    // Inventario deducido: 5 → 0.
    const [inv] = await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'")
    expect(inv.quantity).toBe(0)

    // La cotización quedó convertida.
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

    // Pedidas 7, llegan 10 → excedente 3 al inventario (partía de 0 tras el split).
    expect((await confirm(10)).status).toBe(200)
    expect(await stock()).toBe(3)

    // Re-confirmar con el MISMO número → delta 0 → idempotente.
    expect((await confirm(10)).status).toBe(200)
    expect(await stock()).toBe(3)

    // Corregir a la baja (7 = lo pedido) → excedente 0 → resta los 3.
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
    expect(inv.quantity).toBe(0) // sigue en 0: lo pedido es del cliente, no stock
  })
})

describe('cancel → restaura inventario (integración local)', () => {
  test('cancelar una orden recién creada restaura el stock reservado', async () => {
    const { id } = await approvedQuotation()
    const { order_id } = await readJson<{ order_id: string }>(await createFromQuote(id))
    // Tras el split el inventario está en 0 (se reservaron 5).
    expect(Number((await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'"))[0].quantity)).toBe(0)

    const res = await cancel.POST(makeRequest(undefined, { method: 'POST' }), makeParams({ id: order_id }))
    expect(res.status).toBe(200)

    // in_stock (5) + min(recibido 0, pedido 7)=0 → restaura 5.
    const [inv] = await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'")
    expect(inv.quantity).toBe(5)
    const [o] = await sql<{ status: string }>('SELECT status FROM orders WHERE id = $1', [order_id])
    expect(o.status).toBe('cancelled')
  })
})
