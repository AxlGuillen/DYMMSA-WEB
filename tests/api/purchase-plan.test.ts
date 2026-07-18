/**
 * Planificador de compra (ADR-018) — rutas de plan y decisiones.
 *
 *   - GET /orders/[id]/purchase-plan: plan calculado al vuelo; catálogo y
 *     settings degradan a defaults, ítems/decisiones son fatales.
 *   - PUT /orders/[id]/purchase-decisions: replace-all con normalización,
 *     pre-flight del CHECK de cobertura y limpieza de keys removidas.
 */

import { describe, test, expect, vi } from 'vitest'
import {
  createMockSupabase,
  MockSupabaseClient,
  filterValue,
} from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import * as planRoute from '@/app/api/orders/[id]/purchase-plan/route'
import * as decisionsRoute from '@/app/api/orders/[id]/purchase-decisions/route'
import type { PurchasePlan } from '@/lib/purchase-plan'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const ORDER = { id: 'o1', name: 'Orden 1', status: 'ordered', customer_name: 'ACME' }

function orderItem(overrides: Record<string, unknown> = {}) {
  return {
    id: `i-${Math.random().toString(36).slice(2, 6)}`,
    item_type: 'product',
    etm: 'ETM-1',
    model_code: 'URR-1',
    brand: 'URREA',
    section_label: null,
    quantity_to_order: 5,
    unit_price: 100,
    ...overrides,
  }
}

function decisionInput(overrides: Record<string, unknown> = {}) {
  return {
    model_code: 'URR-1',
    brand: 'URREA',
    std_snapshot: 10,
    needed_qty: 5,
    packages_wholesale: 1,
    qty_retail: 0,
    ...overrides,
  }
}

const getPlan = (id = 'o1') => planRoute.GET(makeRequest(), makeParams({ id }))
const putDecisions = (body: unknown, id = 'o1') =>
  decisionsRoute.PUT(makeRequest(body, { method: 'PUT' }), makeParams({ id }))

// ─── GET /orders/[id]/purchase-plan ──────────────────────────────────────

describe('GET /orders/[id]/purchase-plan', () => {
  test('404 si la orden no existe', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await getPlan()).status).toBe(404)
  })

  test('plan feliz: buckets por catálogo, consolidación y defaults de umbrales', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: ORDER, error: null },
        'order_items.select': {
          data: [
            // duplicado consolidable: 5 + 5 con STD 10 → encaje exacto
            orderItem({ model_code: 'URR-1', quantity_to_order: 5 }),
            orderItem({ model_code: 'URR-1', quantity_to_order: 5 }),
            // no está en catálogo → local
            orderItem({ model_code: 'OTRA-9' }),
          ],
          error: null,
        },
        'urrea_catalog.select': {
          data: [{ code: 'URR-1', brand: 'URREA', description: 'Producto 1', std: 10 }],
          error: null,
        },
        'order_purchase_decisions.select': { data: [], error: null },
        'app_settings.select': { data: [], error: null },
      },
    })

    const res = await getPlan()
    expect(res.status).toBe(200)
    const { order, plan } = await readJson<{ order: typeof ORDER; plan: PurchasePlan }>(res)
    expect(order.id).toBe('o1')
    expect(plan.thresholds).toEqual({ money: 100, pct: 0.8 })
    expect(plan.summary).toMatchObject({ urrea: 1, local: 1 })
    const urrea = plan.groups.find((g) => g.bucket === 'urrea')!
    expect(urrea.needed).toBe(10)
    expect(urrea.recommendation?.type).toBe('wholesale_exact')
  })

  test('umbrales de app_settings pisan los defaults', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: ORDER, error: null },
        'order_items.select': { data: [orderItem()], error: null },
        'urrea_catalog.select': { data: [], error: null },
        'order_purchase_decisions.select': { data: [], error: null },
        'app_settings.select': {
          data: [
            { key: 'purchase_threshold_money', value: 250 },
            { key: 'purchase_threshold_pct', value: 0.5 },
          ],
          error: null,
        },
      },
    })
    const { plan } = await readJson<{ plan: PurchasePlan }>(await getPlan())
    expect(plan.thresholds).toEqual({ money: 250, pct: 0.5 })
  })

  test('REGLA: el catálogo degrada (200, grupos a local), los ítems son fatales (500)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: ORDER, error: null },
        'order_items.select': { data: [orderItem()], error: null },
        'urrea_catalog.select': { data: null, error: { message: 'boom' } },
        'order_purchase_decisions.select': { data: [], error: null },
        'app_settings.select': { data: [], error: null },
      },
    })
    const res = await getPlan()
    expect(res.status).toBe(200)
    const { plan } = await readJson<{ plan: PurchasePlan }>(res)
    expect(plan.groups[0].bucket).toBe('local')

    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: ORDER, error: null },
        'order_items.select': { data: null, error: { message: 'boom' } },
      },
    })
    expect((await getPlan()).status).toBe(500)
  })

  test('casa decisiones guardadas y marca staleness', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: ORDER, error: null },
        'order_items.select': {
          data: [orderItem({ model_code: 'URR-1', quantity_to_order: 12 })],
          error: null,
        },
        'urrea_catalog.select': {
          data: [{ code: 'URR-1', brand: 'URREA', description: null, std: 10 }],
          error: null,
        },
        'order_purchase_decisions.select': {
          data: [
            {
              id: 'd1', order_id: 'o1', model_code: 'URR-1', brand: 'URREA',
              std_snapshot: 10, needed_qty: 10, packages_wholesale: 1, qty_retail: 0,
              decided_at: '2026-07-15T00:00:00Z',
            },
          ],
          error: null,
        },
        'app_settings.select': { data: [], error: null },
      },
    })
    const { plan } = await readJson<{ plan: PurchasePlan }>(await getPlan())
    // Se decidió con N=10 pero ahora se necesitan 12 → stale
    expect(plan.groups[0].decision?.isStale).toBe(true)
    expect(plan.summary).toMatchObject({ decided: 1, stale: 1 })
  })
})

// ─── PUT /orders/[id]/purchase-decisions ─────────────────────────────────

describe('PUT /orders/[id]/purchase-decisions', () => {
  test('404 orden inexistente; 400 orden completada/cancelada', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await putDecisions({ decisions: [] })).status).toBe(404)

    for (const status of ['completed', 'cancelled']) {
      activeClient = createMockSupabase({
        user: AUTH,
        responses: { 'orders.select': { data: { id: 'o1', status }, error: null } },
      })
      expect((await putDecisions({ decisions: [] })).status).toBe(400)
    }
  })

  test('400 por body/filas inválidas', async () => {
    const withOrder = () =>
      createMockSupabase({
        user: AUTH,
        responses: { 'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null } },
      })

    activeClient = withOrder()
    expect((await putDecisions({})).status).toBe(400) // sin array

    activeClient = withOrder()
    expect(
      (await putDecisions({ decisions: [decisionInput({ model_code: '  ' })] })).status,
    ).toBe(400) // sin código

    activeClient = withOrder()
    expect(
      (await putDecisions({ decisions: [decisionInput({ needed_qty: 0 })] })).status,
    ).toBe(400) // necesidad 0

    activeClient = withOrder()
    // 1 paq × 10 + 0 = 10 < 15 → no cubre (pre-flight del CHECK)
    const res = await putDecisions({ decisions: [decisionInput({ needed_qty: 15 })] })
    expect(res.status).toBe(400)
    expect((await readJson<{ message: string }>(res)).message).toContain('URR-1')

    activeClient = withOrder()
    // Duplicado tras normalización: ' urr-1 ' y 'URR-1'
    expect(
      (
        await putDecisions({
          decisions: [decisionInput(), decisionInput({ model_code: ' urr-1 ' })],
        })
      ).status,
    ).toBe(400)
  })

  test('happy path: normaliza, upsert con onConflict, limpia removidas DESPUÉS del upsert', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null },
        'order_purchase_decisions.upsert': { data: [{ id: 'd1' }], error: null },
        'order_purchase_decisions.select': {
          // existente que ya no viene en el set → debe borrarse
          data: [
            { id: 'd1', model_code: 'URR-1', brand: 'URREA' },
            { id: 'd-old', model_code: 'VIEJA-1', brand: 'URREA' },
          ],
          error: null,
        },
        'order_purchase_decisions.delete': { data: null, error: null },
      },
    })

    const res = await putDecisions({
      decisions: [decisionInput({ model_code: ' urr-1 ', brand: 'urrea' })],
    })
    expect(res.status).toBe(200)

    // Normalización antes de persistir
    const rows = activeClient.upsertPayload('order_purchase_decisions')
    expect(rows[0].model_code).toBe('URR-1')
    expect(rows[0].brand).toBe('URREA')
    expect(rows[0].order_id).toBe('o1')
    expect(rows[0].decided_at).toBeTruthy()

    // onConflict = identidad del grupo
    const upsertCall = activeClient.callsTo('order_purchase_decisions', 'upsert')[0]
    expect(upsertCall.options).toEqual({ onConflict: 'order_id,model_code,brand' })

    // Limpieza: borra solo la key removida, y DESPUÉS del upsert
    const deleteCall = activeClient.callsTo('order_purchase_decisions', 'delete')[0]
    expect(filterValue(deleteCall, 'id', 'in')).toEqual(['d-old'])
    const ops = activeClient
      .callsTo('order_purchase_decisions')
      .map((c) => c.op)
    expect(ops.indexOf('upsert')).toBeLessThan(ops.indexOf('delete'))
  })

  test('set vacío: no upserta y borra todas las existentes', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null },
        'order_purchase_decisions.select': {
          data: [{ id: 'd1', model_code: 'URR-1', brand: 'URREA' }],
          error: null,
        },
        'order_purchase_decisions.delete': { data: null, error: null },
      },
    })
    const res = await putDecisions({ decisions: [] })
    expect(res.status).toBe(200)
    expect(activeClient.didCall('order_purchase_decisions', 'upsert')).toBe(false)
    const deleteCall = activeClient.callsTo('order_purchase_decisions', 'delete')[0]
    expect(filterValue(deleteCall, 'id', 'in')).toEqual(['d1'])
  })

  test('constraint de cobertura desde la BD (carrera) → 400 descriptivo', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: { id: 'o1', status: 'ordered' }, error: null },
        'order_purchase_decisions.upsert': {
          data: null,
          error: {
            code: '23514',
            message: 'new row violates check constraint "check_decision_covers_needed"',
          },
        },
      },
    })
    const res = await putDecisions({ decisions: [decisionInput()] })
    expect(res.status).toBe(400)
    expect((await readJson<{ message: string }>(res)).message).toMatch(/no cubre/i)
  })
})
