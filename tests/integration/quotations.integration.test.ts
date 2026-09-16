/**
 * Saving a quotation against local Supabase (ADR-021): exercises real auth,
 * RLS and SQL — only `createClient()` differs from production.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, readJson } from '../helpers/request'
import { authedClient } from './helpers/clients'
import { resetDb, sql, closePool } from './helpers/db'
import * as save from '@/app/api/quotations/save/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

beforeAll(async () => {
  activeClient = await authedClient()
})
beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await closePool()
})

/** Minimal product item in the shape the handler expects. */
function product(over: Record<string, unknown> = {}) {
  return {
    _id: crypto.randomUUID(),
    item_type: 'product',
    section_label: '',
    etm: 'X',
    description: 'desc',
    description_es: 'desc es',
    dymmsa_description: '',
    model_code: '',
    brand: '',
    unit_price: 10,
    quantity: 1,
    delivery_time: 'immediate',
    is_sold: null,
    _inDb: false,
    ...over,
  }
}

describe('POST /quotations/save (integración local)', () => {
  test('crea cotización + ítems, congela la Desc. DYMMSA del catálogo y auto-learn agrega el nuevo', async () => {
    const res = await save.POST(
      makeRequest({
        name: 'Q Integración',
        customer_name: 'ACME',
        items: [
          // Catalog product: its DYMMSA description resolves to the official one.
          product({ etm: 'SEED-URREA-1', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, is_sold: true, _inDb: true }),
          // New product: auto-learn must add it.
          product({ etm: 'NEW-INT-1', model_code: '70001', brand: 'URREA', description: 'Martillo nuevo', unit_price: 40, quantity: 5 }),
        ],
      }),
    )

    expect(res.status).toBe(200)
    const json = await readJson<{ quotation_id: string; auto_learn: { added: number } }>(res)
    expect(json.quotation_id).toBeTruthy()

    const items = await sql<{ etm: string; sort_order: number; is_approved: boolean | null; dymmsa_description: string | null }>(
      'SELECT etm, sort_order, is_approved, dymmsa_description FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order',
      [json.quotation_id],
    )
    expect(items.map((i) => i.etm)).toEqual(['SEED-URREA-1', 'NEW-INT-1'])
    expect(items.every((i) => i.is_approved === null)).toBe(true)

    // The official catalog description wins and is frozen (ADR-013).
    expect(items[0].dymmsa_description).toBe('Botador de cobre 30/300mm (oficial URREA)')

    // Total: 100x2 + 40x5 = 400.
    const [q] = await sql<{ total_amount: string }>('SELECT total_amount FROM quotations WHERE id = $1', [json.quotation_id])
    expect(Number(q.total_amount)).toBe(400)

    expect(json.auto_learn.added).toBeGreaterThanOrEqual(1)
    const learned = await sql("SELECT etm FROM etm_products WHERE etm = 'NEW-INT-1'")
    expect(learned).toHaveLength(1)
  })
})
