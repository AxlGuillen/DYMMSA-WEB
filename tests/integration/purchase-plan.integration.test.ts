/**
 * Integración (Tier 1) — decisiones de compra (mayoreo/menudeo) contra el
 * Supabase LOCAL. El PUT es replace-all (ADR-018): upsert por
 * (order_id, model_code, brand) + purga de las removidas. Decisiones de dinero
 * → vale probar el reemplazo real contra la BD (UNIQUE + upsert + delete).
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams } from '../helpers/request'
import { authedClient } from './helpers/clients'
import { resetDb, sql, closePool } from './helpers/db'
import * as decisions from '@/app/api/orders/[id]/purchase-decisions/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

beforeAll(async () => { activeClient = await authedClient() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

async function seedOrder(): Promise<string> {
  const [o] = await sql<{ id: string }>(
    "INSERT INTO orders (name, customer_name, status, total_amount) VALUES ('O','ACME','ordered',0) RETURNING id",
  )
  return o.id
}

const put = (orderId: string, decisionsBody: unknown[]) =>
  decisions.PUT(makeRequest({ decisions: decisionsBody }, { method: 'PUT' }), makeParams({ id: orderId }))

describe('PUT /orders/[id]/purchase-decisions (integración local)', () => {
  test('replace-all: upsert actualiza, agrega nuevas y PURGA las removidas; normaliza code/brand', async () => {
    const orderId = await seedOrder()

    // Set inicial: 2 decisiones (una con code/brand en minúsculas → normaliza).
    expect((await put(orderId, [
      { model_code: ' aa-1 ', brand: 'urrea', std_snapshot: 10, needed_qty: 12, packages_wholesale: 1, qty_retail: 2 },
      { model_code: 'BB-2', brand: 'SURTEK', std_snapshot: 6, needed_qty: 6, packages_wholesale: 1, qty_retail: 0 },
    ])).status).toBe(200)

    expect(await sql<{ model_code: string; brand: string; packages_wholesale: number }>(
      'SELECT model_code, brand, packages_wholesale FROM order_purchase_decisions WHERE order_id = $1 ORDER BY model_code', [orderId],
    )).toEqual([
      { model_code: 'AA-1', brand: 'URREA', packages_wholesale: 1 },  // normalizado
      { model_code: 'BB-2', brand: 'SURTEK', packages_wholesale: 1 },
    ])

    // Replace: AA-1 modificado (upsert) + CC-3 nueva; BB-2 ya no viene → se purga.
    expect((await put(orderId, [
      { model_code: 'AA-1', brand: 'URREA', std_snapshot: 10, needed_qty: 12, packages_wholesale: 0, qty_retail: 12 },
      { model_code: 'CC-3', brand: 'URREA', std_snapshot: 1, needed_qty: 3, packages_wholesale: 3, qty_retail: 0 },
    ])).status).toBe(200)

    expect(await sql<{ model_code: string; packages_wholesale: number }>(
      'SELECT model_code, packages_wholesale FROM order_purchase_decisions WHERE order_id = $1 ORDER BY model_code', [orderId],
    )).toEqual([
      { model_code: 'AA-1', packages_wholesale: 0 },  // upsert la actualizó (sin duplicar)
      { model_code: 'CC-3', packages_wholesale: 3 },  // nueva
      // BB-2 purgada
    ])
  })

  test('rechaza una decisión que no cubre la necesidad (pre-check del CHECK) → 400', async () => {
    const orderId = await seedOrder()
    // 1 paq × 10 + 0 = 10 < 12 → no cubre.
    const res = await put(orderId, [
      { model_code: 'X', brand: 'URREA', std_snapshot: 10, needed_qty: 12, packages_wholesale: 1, qty_retail: 0 },
    ])
    expect(res.status).toBe(400)
    expect(await sql('SELECT 1 FROM order_purchase_decisions WHERE order_id = $1', [orderId])).toHaveLength(0)
  })

  test('orden inexistente → 404', async () => {
    const res = await put('00000000-0000-0000-0000-0000000000ff', [])
    expect(res.status).toBe(404)
  })
})
