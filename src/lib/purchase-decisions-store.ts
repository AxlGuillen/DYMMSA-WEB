/**
 * Purchase decisions of an order (ADR-018), shared by PUT /api/orders/[id]/purchase-decisions and the MCP's
 * save_purchase_decisions (#155 D): the validation of the rows, the replace-all (upsert BEFORE the delete) and the
 * plan the tool decides over. The tool never takes numbers: STD and need come from the plan the server builds.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeCatalogBrand, normalizeCatalogCode } from '@/lib/business-rules'
import { DomainError, type DomainErrorKind } from '@/lib/domain-error'
import {
  applyChoice,
  buildPurchasePlan,
  choiceOf,
  resolveThresholds,
  SETTING_THRESHOLD_MONEY,
  SETTING_THRESHOLD_PCT,
  type PlannableItem,
  type PurchaseChoice,
  type PurchaseGroupPlan,
  type PurchasePlan,
} from '@/lib/purchase-plan'
import { explainPgError } from '@/lib/supabase-errors'
import { fetchCatalogEntryMap } from '@/lib/urrea-catalog'
import type { OrderPurchaseDecision, OrderPurchaseDecisionInsert } from '@/types/database'

export class PurchaseDecisionError extends DomainError {
  constructor(message: string, kind: DomainErrorKind = 'invalid') {
    super(message, kind)
    this.name = 'PurchaseDecisionError'
  }
}

const CLOSED_MESSAGE = 'No se puede modificar una orden completada o cancelada'

interface DecisionInput {
  model_code: string
  brand: string
  std_snapshot: number
  needed_qty: number
  packages_wholesale: number
  qty_retail: number
}

const isNonNegativeInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

/** The rows to store, validated one by one with a message that names the group (the route's own rules). */
export function parseDecisions(orderId: string, decisions: unknown): OrderPurchaseDecisionInsert[] {
  if (!Array.isArray(decisions)) throw new PurchaseDecisionError('El body debe incluir un array "decisions"')
  const seen = new Set<string>()
  const rows: OrderPurchaseDecisionInsert[] = []
  for (const d of decisions as DecisionInput[]) {
    const model_code = normalizeCatalogCode(d.model_code)
    const brand = normalizeCatalogBrand(d.brand)
    if (!model_code) throw new PurchaseDecisionError('Hay una decisión sin código de modelo')
    if (!isNonNegativeInt(d.std_snapshot) || d.std_snapshot < 1) throw new PurchaseDecisionError(`Decisión de "${model_code}": STD inválido`)
    if (!isNonNegativeInt(d.needed_qty) || d.needed_qty < 1) throw new PurchaseDecisionError(`Decisión de "${model_code}": la necesidad debe ser mayor a 0`)
    if (!isNonNegativeInt(d.packages_wholesale) || !isNonNegativeInt(d.qty_retail)) throw new PurchaseDecisionError(`Decisión de "${model_code}": cantidades inválidas`)
    // Pre-flight for the check_decision_covers_needed CHECK, with a clear message.
    if (d.packages_wholesale * d.std_snapshot + d.qty_retail < d.needed_qty) {
      throw new PurchaseDecisionError(
        `Decisión de "${model_code}": no cubre la necesidad (${d.packages_wholesale} paq × ${d.std_snapshot} + ${d.qty_retail} < ${d.needed_qty})`,
      )
    }
    const key = `${brand}|${model_code}`
    if (seen.has(key)) throw new PurchaseDecisionError(`Decisión duplicada para "${model_code}" (${brand})`)
    seen.add(key)
    rows.push({
      order_id: orderId,
      model_code,
      brand,
      std_snapshot: d.std_snapshot,
      needed_qty: d.needed_qty,
      packages_wholesale: d.packages_wholesale,
      qty_retail: d.qty_retail,
      decided_at: new Date().toISOString(),
    })
  }
  return rows
}

/** The order must exist and still be open: a completed or cancelled one is read-only. */
export async function assertOrderOpen(db: SupabaseClient, orderId: string): Promise<void> {
  const { data: order } = await db.from('orders').select('id, status').eq('id', orderId).single()
  if (!order) throw new PurchaseDecisionError('Orden no encontrada', 'not_found')
  if (['completed', 'cancelled'].includes(order.status)) throw new PurchaseDecisionError(CLOSED_MESSAGE)
}

/**
 * Replace-all (ADR-018): upsert BEFORE the delete — a failed cleanup leaves harmless orphans instead of losing
 * decisions. Returns the saved rows.
 */
export async function savePurchaseDecisions(db: SupabaseClient, orderId: string, decisions: unknown): Promise<unknown[]> {
  await assertOrderOpen(db, orderId)
  const rows = parseDecisions(orderId, decisions)
  const seen = new Set(rows.map((row) => `${row.brand}|${row.model_code}`))

  let saved: unknown[] = []
  if (rows.length > 0) {
    const { data, error: upsertError } = await db.from('order_purchase_decisions').upsert(rows, { onConflict: 'order_id,model_code,brand' }).select()
    if (upsertError) {
      console.error('purchase-decisions upsert error:', upsertError)
      const explanation = explainPgError(upsertError)
      if (explanation.isConstraintViolation) throw new PurchaseDecisionError(explanation.userMessage)
      throw new PurchaseDecisionError('Error al guardar las decisiones de compra', 'failed')
    }
    saved = data ?? []
  }

  const { data: existing } = await db.from('order_purchase_decisions').select('id, model_code, brand').eq('order_id', orderId)
  const removedIds = (existing ?? []).filter((row) => !seen.has(`${row.brand}|${row.model_code}`)).map((row) => row.id)
  if (removedIds.length > 0) {
    const { error: deleteError } = await db.from('order_purchase_decisions').delete().in('id', removedIds)
    // Leftover rows are harmless (they show up as orphans in the plan).
    if (deleteError) console.warn('purchase-decisions cleanup error (ignored):', deleteError)
  }
  return saved
}

/** The plan the planner screen builds, from the stored lines, catalog, thresholds and decisions. */
export async function loadPurchasePlan(db: SupabaseClient, orderId: string): Promise<{ plan: PurchasePlan; decisions: OrderPurchaseDecision[] }> {
  const { data: items, error: itemsError } = await db
    .from('order_items')
    .select('id, item_type, etm, model_code, brand, description, section_label, quantity_to_order, unit_price')
    .eq('order_id', orderId)
    .limit(5000)
  if (itemsError) throw new PurchaseDecisionError('Error al leer los productos de la orden', 'failed')
  const plannable = (items ?? []) as PlannableItem[]

  const [catalog, decisionsRes, settingsRes] = await Promise.all([
    fetchCatalogEntryMap(db, plannable.map((i) => i.model_code)),
    db.from('order_purchase_decisions').select('*').eq('order_id', orderId),
    db.from('app_settings').select('key, value').in('key', [SETTING_THRESHOLD_MONEY, SETTING_THRESHOLD_PCT]),
  ])
  if (decisionsRes.error) throw new PurchaseDecisionError('Error al leer las decisiones de compra', 'failed')
  const thresholds = resolveThresholds(Object.fromEntries(((settingsRes.data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value])))
  const decisions = (decisionsRes.data ?? []) as OrderPurchaseDecision[]
  return { plan: buildPurchasePlan(plannable, catalog, decisions, thresholds), decisions }
}

/** Groups that carry math (catalog): the ones that get a decision. Local-purchase groups have none. */
export const decidableGroups = (plan: PurchasePlan): PurchaseGroupPlan[] => plan.groups.filter((group) => group.math !== null)

export interface DecisionSet {
  /** What the screen would send: every decidable group, with its split on the CURRENT math. */
  rows: Omit<OrderPurchaseDecisionInsert, 'order_id'>[]
  /** Groups with no choice at all («Revisar» not decided, or never decided without accepting the recommendation). */
  undecided: PurchaseGroupPlan[]
  /** The choice each decidable group ends up with, by group key. */
  choices: Map<string, PurchaseChoice>
}

/**
 * The full set (replace-all means a partial one would delete the rest): the explicit choice, else the saved one
 * (re-applied to today's math, as the screen does with a stale one), else the recommendation when asked for.
 */
export function buildDecisionSet(plan: PurchasePlan, explicit: ReadonlyMap<string, PurchaseChoice>, acceptRecommendations: boolean): DecisionSet {
  const rows: DecisionSet['rows'] = []
  const undecided: PurchaseGroupPlan[] = []
  const choices = new Map<string, PurchaseChoice>()
  for (const group of decidableGroups(plan)) {
    const choice =
      explicit.get(group.key) ?? (group.decision ? choiceOf(group.decision) : null) ?? (acceptRecommendations ? (group.recommendation?.suggested ?? null) : null)
    if (!choice) {
      undecided.push(group)
      continue
    }
    const split = applyChoice(group.math!, choice)
    choices.set(group.key, choice)
    rows.push({
      model_code: group.modelCode,
      brand: group.brand,
      std_snapshot: group.math!.std,
      needed_qty: group.needed,
      packages_wholesale: split.packagesWholesale,
      qty_retail: split.qtyRetail,
    })
  }
  return { rows, undecided, choices }
}
