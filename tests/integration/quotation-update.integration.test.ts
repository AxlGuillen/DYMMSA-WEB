/**
 * Integración (Tier 1) — UPDATE de cotización contra el Supabase LOCAL.
 * El handler más intrincado: delete+reinsert preservando is_approved, con
 * rollback si el re-insert falla. Es el que más se toca (Fase 5.5) y una
 * regresión aquí PIERDE decisiones del cliente — de ahí el valor de probarlo
 * contra la BD real.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams } from '../helpers/request'
import { authedClient } from './helpers/clients'
import { resetDb, sql, seedQuotation, closePool } from './helpers/db'
import * as update from '@/app/api/quotations/[id]/update/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

beforeAll(async () => { activeClient = await authedClient() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

const patch = (id: string, body: unknown) =>
  update.PATCH(makeRequest(body, { method: 'PATCH' }), makeParams({ id }))

describe('PATCH /quotations/[id]/update (integración local)', () => {
  test('reabrir/editar PRESERVA is_approved vía _dbId (no pierde decisiones del cliente)', async () => {
    const { id, itemIds } = await seedQuotation({
      status: 'approved',
      items: [
        { etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, is_approved: true },
        { etm: 'B', model_code: '60002', brand: 'URREA', unit_price: 50, quantity: 1, is_approved: false },
      ],
    })

    // La UI reenvía los 2 existentes con su _dbId y SIN is_approved (→ fallback a
    // la decisión persistida) + 1 producto nuevo.
    const res = await patch(id, {
      name: 'Editada', customer_name: 'ACME',
      items: [
        { _dbId: itemIds[0], item_type: 'product', etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, delivery_time: 'immediate' },
        { _dbId: itemIds[1], item_type: 'product', etm: 'B', model_code: '60002', brand: 'URREA', unit_price: 50, quantity: 1, delivery_time: 'immediate' },
        { _id: 'new', item_type: 'product', etm: 'C', model_code: '', brand: '', unit_price: 30, quantity: 5, delivery_time: 'immediate' },
      ],
    })
    expect(res.status).toBe(200)

    const items = await sql<{ etm: string; is_approved: boolean | null }>(
      'SELECT etm, is_approved FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order', [id],
    )
    expect(items).toEqual([
      { etm: 'A', is_approved: true },   // decisión preservada
      { etm: 'B', is_approved: false },  // decisión preservada
      { etm: 'C', is_approved: null },   // nuevo → pendiente
    ])
  })

  test('re-resuelve y congela la Desc. DYMMSA del catálogo real al editar', async () => {
    const { id, itemIds } = await seedQuotation({
      status: 'approved',
      items: [{ etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 1, is_approved: true }],
    })
    await patch(id, {
      name: 'Editada', customer_name: 'ACME',
      items: [{ _dbId: itemIds[0], item_type: 'product', etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 1, delivery_time: 'immediate' }],
    })
    const [item] = await sql<{ dymmsa_description: string | null }>('SELECT dymmsa_description FROM quotation_items WHERE quotation_id = $1', [id])
    expect(item.dymmsa_description).toBe('Botador de cobre 30/300mm (oficial URREA)')
  })

  test('si el re-insert VIOLA un CHECK (cantidad 0) → 400 y ROLLBACK conserva los originales', async () => {
    const { id } = await seedQuotation({
      status: 'draft',
      items: [{ etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, is_approved: true }],
    })

    // quantity 0 viola quotation_items_quantity_check → el insert falla.
    const res = await patch(id, {
      name: 'X', customer_name: 'ACME',
      items: [{ item_type: 'product', etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 0, delivery_time: 'immediate' }],
    })
    expect(res.status).toBe(400)

    // Rollback: el delete ya había borrado, pero el original volvió intacto.
    const items = await sql<{ etm: string; is_approved: boolean | null; quantity: number }>(
      'SELECT etm, is_approved, quantity FROM quotation_items WHERE quotation_id = $1', [id],
    )
    expect(items).toEqual([{ etm: 'A', is_approved: true, quantity: 2 }])
  })
})
