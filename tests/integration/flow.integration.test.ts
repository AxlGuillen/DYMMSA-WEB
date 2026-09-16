/**
 * Full chain against local Supabase (ADR-021), all real handlers:
 * save → send for approval → customer approves → create order → receive.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer, injectSupabaseAdmin } from '../helpers/setup'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import { authedClient, serviceClient } from './helpers/clients'
import { resetDb, sql, closePool } from './helpers/db'
import * as save from '@/app/api/quotations/save/route'
import * as statusRoute from '@/app/api/quotations/[id]/status/route'
import * as approve from '@/app/api/approve/[token]/route'
import * as createOrder from '@/app/api/quotations/[id]/create-order/route'
import * as reception from '@/app/api/orders/[id]/confirm-reception/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)
injectSupabaseAdmin(() => serviceClient() as never)

beforeAll(async () => { activeClient = await authedClient() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

function product(over: Record<string, unknown> = {}) {
  return {
    _id: crypto.randomUUID(), item_type: 'product', section_label: '',
    etm: 'X', description: 'd', description_es: 'd', dymmsa_description: '',
    model_code: '', brand: '', unit_price: 10, quantity: 1,
    delivery_time: 'immediate', is_sold: null, _inDb: false, ...over,
  }
}

describe('Cadena completa: cotización → aprobación → orden → recepción', () => {
  test('progresión de estado end-to-end contra la BD real', async () => {
    // 1. Save quotation (draft).
    const saveRes = await save.POST(makeRequest({
      name: 'Flujo E2E', customer_name: 'ACME',
      items: [
        product({ etm: 'SEED-URREA-1', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 12, is_sold: true, _inDb: true }),
        product({ etm: 'SEED-URREA-2', model_code: '60002', brand: 'URREA', unit_price: 50, quantity: 3, is_sold: true, _inDb: true }),
      ],
    }))
    const { quotation_id } = await readJson<{ quotation_id: string }>(saveRes)
    expect(quotation_id).toBeTruthy()

    // 2. Send for approval (regenerates the token).
    expect((await statusRoute.PATCH(makeRequest({ status: 'sent_for_approval' }, { method: 'PATCH' }), makeParams({ id: quotation_id }))).status).toBe(200)
    const [q1] = await sql<{ approval_token: string; status: string }>('SELECT approval_token, status FROM quotations WHERE id = $1', [quotation_id])
    expect(q1.status).toBe('sent_for_approval')

    // 3. Customer approves both (finalize).
    const itemIds = (await sql<{ id: string }>('SELECT id FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order', [quotation_id])).map((r) => r.id)
    const appRes = await approve.POST(
      makeRequest({ approvedIds: itemIds, finalize: true }, { method: 'POST' }),
      makeParams({ token: q1.approval_token }),
    )
    expect(await readJson<{ status: string }>(appRes)).toMatchObject({ status: 'approved' })
    const [q2] = await sql<{ status: string; approved_at: string | null }>('SELECT status, approved_at FROM quotations WHERE id = $1', [quotation_id])
    expect(q2.status).toBe('approved')
    expect(q2.approved_at).not.toBeNull()

    // 4. Create order (inventory split).
    const { order_id } = await readJson<{ order_id: string }>(
      await createOrder.POST(makeRequest(undefined, { method: 'POST' }), makeParams({ id: quotation_id })),
    )
    expect(order_id).toBeTruthy()
    const [q3] = await sql<{ status: string }>('SELECT status FROM quotations WHERE id = $1', [quotation_id])
    expect(q3.status).toBe('converted_to_order')

    // 60001 (stock 5): 5 in stock / 7 to order. 60002 (no stock): 0 / 3.
    const [p1] = await sql<{ quantity_in_stock: number; quantity_to_order: number }>("SELECT quantity_in_stock, quantity_to_order FROM order_items WHERE order_id = $1 AND etm = 'SEED-URREA-1'", [order_id])
    expect(p1).toMatchObject({ quantity_in_stock: 5, quantity_to_order: 7 })
    expect(Number((await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'"))[0].quantity)).toBe(0)

    // 5. Receive with excess: 7 ordered, 10 arrive → +3 to inventory.
    const [p1item] = await sql<{ id: string }>("SELECT id FROM order_items WHERE order_id = $1 AND etm = 'SEED-URREA-1'", [order_id])
    expect((await reception.POST(
      makeRequest({ items: [{ id: p1item.id, quantity_received: 10, urrea_status: 'supplied' }] }, { method: 'POST' }),
      makeParams({ id: order_id }),
    )).status).toBe(200)
    expect(Number((await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'"))[0].quantity)).toBe(3)
  })
})
