/** purchase-decisions-store (#155 D): the route's rules in one place, and the set the tool builds over the plan. */

import { describe, test, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertOrderOpen, buildDecisionSet, parseDecisions, PurchaseDecisionError, savePurchaseDecisions } from '@/lib/purchase-decisions-store'
import { buildPurchasePlan, choiceOf, DEFAULT_PURCHASE_THRESHOLDS, type PlannableItem } from '@/lib/purchase-plan'
import { createMockSupabase } from '../helpers/supabase-mock'
import type { OrderPurchaseDecision } from '@/types/database'

const asDb = (mock: ReturnType<typeof createMockSupabase>) => mock as unknown as SupabaseClient
const ORDER = 'order-1'
const row = (over: Record<string, unknown> = {}) => ({ model_code: ' 6954 ', brand: '', std_snapshot: 10, needed_qty: 37, packages_wholesale: 4, qty_retail: 0, ...over })

function failure(fn: () => unknown): PurchaseDecisionError {
  try {
    fn()
  } catch (error) {
    if (error instanceof PurchaseDecisionError) return error
    throw error
  }
  throw new Error('no lanzó PurchaseDecisionError')
}

describe('parseDecisions', () => {
  test('normaliza código y marca (trim + mayúsculas, URREA por default) y fecha cada fila', () => {
    const [saved] = parseDecisions(ORDER, [row()])
    expect(saved).toMatchObject({ order_id: ORDER, model_code: '6954', brand: 'URREA', packages_wholesale: 4 })
    expect(saved.decided_at).toMatch(/^20/)
  })

  test.each([
    [{ model_code: ' ' }, 'Hay una decisión sin código de modelo'],
    [{ std_snapshot: 0 }, 'Decisión de "6954": STD inválido'],
    [{ needed_qty: 0 }, 'Decisión de "6954": la necesidad debe ser mayor a 0'],
    [{ qty_retail: -1 }, 'Decisión de "6954": cantidades inválidas'],
    [{ packages_wholesale: 2, qty_retail: 5 }, 'Decisión de "6954": no cubre la necesidad (2 paq × 10 + 5 < 37)'],
  ])('REGLA: %j → 400 «%s»', (over, message) => {
    expect(failure(() => parseDecisions(ORDER, [row(over)])).message).toBe(message)
  })

  test('un duplicado, o algo que no es un arreglo, es 400', () => {
    expect(failure(() => parseDecisions(ORDER, [row(), row({ model_code: '6954', brand: 'urrea' })])).message).toBe('Decisión duplicada para "6954" (URREA)')
    expect(failure(() => parseDecisions(ORDER, undefined)).message).toBe('El body debe incluir un array "decisions"')
  })
})

describe('savePurchaseDecisions / assertOrderOpen', () => {
  test('una orden que no existe es 404 y una completada o cancelada, 400, sin tocar las decisiones', async () => {
    const missing = createMockSupabase({ responses: { 'orders.select': { data: null, error: null } } })
    await expect(savePurchaseDecisions(asDb(missing), ORDER, [])).rejects.toMatchObject({ status: 404 })
    const closed = createMockSupabase({ responses: { 'orders.select': { data: { id: ORDER, status: 'completed' }, error: null } } })
    await expect(assertOrderOpen(asDb(closed), ORDER)).rejects.toThrow('No se puede modificar una orden completada o cancelada')
    expect(closed.callsTo('order_purchase_decisions')).toEqual([])
  })

  test('upsert primero y limpieza después: borra solo lo que no vino; un fallo de la limpieza no pierde nada', async () => {
    const db = createMockSupabase({
      responses: {
        'orders.select': { data: { id: ORDER, status: 'ordered' }, error: null },
        'order_purchase_decisions.upsert': { data: [{ id: 'k' }], error: null },
        'order_purchase_decisions.select': { data: [{ id: 'k', model_code: '6954', brand: 'URREA' }, { id: 'old', model_code: 'OLD', brand: 'URREA' }], error: null },
        'order_purchase_decisions.delete': { data: null, error: { message: 'boom' } },
      },
    })
    expect(await savePurchaseDecisions(asDb(db), ORDER, [row()])).toEqual([{ id: 'k' }])
    const ops = db._calls.filter((c) => c.table === 'order_purchase_decisions').map((c) => c.op)
    expect(ops).toEqual(['upsert', 'select', 'delete'])
    expect(db.callsTo('order_purchase_decisions', 'delete')[0].filters.find((f) => f.method === 'in')?.args).toEqual(['id', ['old']])
  })

  test('un arreglo vacío borra todas las decisiones; un fallo del upsert que no es de regla es 500', async () => {
    const empty = createMockSupabase({
      responses: {
        'orders.select': { data: { id: ORDER, status: 'ordered' }, error: null },
        'order_purchase_decisions.select': { data: [{ id: 'old', model_code: 'OLD', brand: 'URREA' }], error: null },
      },
    })
    await savePurchaseDecisions(asDb(empty), ORDER, [])
    expect(empty.didCall('order_purchase_decisions', 'upsert')).toBe(false)
    expect(empty.didCall('order_purchase_decisions', 'delete')).toBe(true)

    const broken = createMockSupabase({ responses: { 'orders.select': { data: { id: ORDER, status: 'ordered' }, error: null }, 'order_purchase_decisions.upsert': { data: null, error: { message: 'boom' } } } })
    await expect(savePurchaseDecisions(asDb(broken), ORDER, [row()])).rejects.toMatchObject({ status: 500, message: 'Error al guardar las decisiones de compra' })
  })
})

describe('buildDecisionSet', () => {
  const items: PlannableItem[] = [
    { id: 'a', item_type: 'product', etm: 'A', model_code: '6954', brand: 'URREA', quantity_to_order: 37, unit_price: 10 },
    { id: 'b', item_type: 'product', etm: 'B', model_code: 'REV1', brand: 'URREA', quantity_to_order: 2, unit_price: 5 },
  ]
  const catalog = new Map([
    ['URREA|6954', { std: 10, description: null }],
    ['URREA|REV1', { std: 10, description: null }],
  ])
  const decisions: OrderPurchaseDecision[] = [
    { id: 'd', order_id: ORDER, model_code: '6954', brand: 'URREA', std_snapshot: 10, needed_qty: 30, packages_wholesale: 3, qty_retail: 0, decided_at: '' },
  ]
  const plan = buildPurchasePlan(items, catalog, decisions, DEFAULT_PURCHASE_THRESHOLDS)

  test('la elección explícita gana, luego la guardada (reaplicada a la matemática de hoy), luego la recomendación si se pide', () => {
    const accepted = buildDecisionSet(plan, new Map([['URREA|REV1', 'retail']]), true)
    expect(accepted.undecided).toEqual([])
    expect(accepted.rows).toEqual([
      { model_code: '6954', brand: 'URREA', std_snapshot: 10, needed_qty: 37, packages_wholesale: 4, qty_retail: 0 },
      { model_code: 'REV1', brand: 'URREA', std_snapshot: 10, needed_qty: 2, packages_wholesale: 0, qty_retail: 2 },
    ])
    expect(choiceOf(decisions[0])).toBe('wholesale')
  })

  test('REGLA: el grupo «revisar» sin decidir queda fuera del set y se reporta, aun aceptando las recomendaciones', () => {
    const set = buildDecisionSet(plan, new Map(), true)
    expect(set.undecided.map((g) => g.modelCode)).toEqual(['REV1'])
    expect(set.rows.map((r) => r.model_code)).toEqual(['6954'])
  })

  test('sin aceptar recomendaciones, solo lo explícito o lo guardado cuenta', () => {
    const set = buildDecisionSet(plan, new Map(), false)
    expect(set.undecided.map((g) => g.modelCode)).toEqual(['REV1'])
    expect([...set.choices.keys()]).toEqual(['URREA|6954'])
  })
})
