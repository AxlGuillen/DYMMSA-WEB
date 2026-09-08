/** Purchase planner (ADR-018): wholesale vs retail, decided per order (never a global truth), over
 *  quantities consolidated by catalogKey — the real choice is about the remainder. */

import type { OrderPurchaseDecision } from '@/types/database'
import {
  catalogKey,
  isProductItem,
  normalizeCatalogBrand,
  normalizeCatalogCode,
} from '@/lib/business-rules'

export interface PurchaseThresholds {
  /** Money parked (MXN) above which the remainder is better bought retail. */
  money: number
  /** Fraction of the extra package left parked that forces a manual review. */
  pct: number
}

export const DEFAULT_PURCHASE_THRESHOLDS: PurchaseThresholds = { money: 100, pct: 0.8 }

export const SETTING_THRESHOLD_MONEY = 'purchase_threshold_money'
export const SETTING_THRESHOLD_PCT = 'purchase_threshold_pct'

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Invalid values fall back to the defaults so config never breaks the plan. */
export function resolveThresholds(settings: Record<string, unknown>): PurchaseThresholds {
  const money = asFiniteNumber(settings[SETTING_THRESHOLD_MONEY])
  const pct = asFiniteNumber(settings[SETTING_THRESHOLD_PCT])
  return {
    money: money != null && money > 0 ? money : DEFAULT_PURCHASE_THRESHOLDS.money,
    pct: pct != null && pct > 0 && pct <= 1 ? pct : DEFAULT_PURCHASE_THRESHOLDS.pct,
  }
}

/** Structural subset of OrderItem the planner needs. */
export interface PlannableItem {
  id: string
  item_type?: string | null
  etm: string | null
  model_code: string
  brand: string
  description?: string | null
  section_label?: string | null
  quantity_to_order: number
  unit_price: number
}

/** Catalog row relevant to the plan (see fetchCatalogEntryMap). */
export interface CatalogEntry {
  std: number
  description: string | null
}

/** Original order line feeding a group. */
export interface PurchaseSourceLine {
  itemId: string
  etm: string | null
  sectionLabel: string | null
  /** Raw model_code from the order; may differ from the normalized one. */
  modelCodeRaw: string
  description: string | null
  quantityToOrder: number
  unitPrice: number
}

export interface ConsolidatedGroup {
  /** catalogKey(model_code, brand); lines without model_code never merge. */
  key: string
  modelCode: string // normalized
  brand: string // normalized
  /** Σ quantity_to_order of the group's lines. */
  needed: number
  /** Quantity-weighted average of the lines priced > 0; null when none is. */
  unitPrice: number | null
  lines: PurchaseSourceLine[]
}

/** Groups by catalogKey. Without model_code there is no safe cross, so each item is its own group. */
export function consolidateOrderItems(items: PlannableItem[]): ConsolidatedGroup[] {
  const groups = new Map<string, ConsolidatedGroup>()

  for (const item of items) {
    if (!isProductItem(item)) continue
    if (item.quantity_to_order <= 0) continue

    const code = normalizeCatalogCode(item.model_code)
    const key = code ? catalogKey(item.model_code, item.brand) : `__nocode__|${item.id}`

    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        modelCode: code,
        brand: normalizeCatalogBrand(item.brand),
        needed: 0,
        unitPrice: null,
        lines: [],
      }
      groups.set(key, group)
    }

    group.needed += item.quantity_to_order
    group.lines.push({
      itemId: item.id,
      etm: item.etm || null,
      sectionLabel: item.section_label ?? null,
      modelCodeRaw: item.model_code,
      description: item.description || null,
      quantityToOrder: item.quantity_to_order,
      unitPrice: item.unit_price,
    })
  }

  for (const group of groups.values()) {
    const priced = group.lines.filter((l) => l.unitPrice > 0)
    if (priced.length > 0) {
      const qty = priced.reduce((sum, l) => sum + l.quantityToOrder, 0)
      const amount = priced.reduce((sum, l) => sum + l.quantityToOrder * l.unitPrice, 0)
      group.unitPrice = amount / qty
    }
  }

  return [...groups.values()]
}

export interface PurchaseGroupMath {
  needed: number
  std: number
  unitPrice: number | null
  /** floor(N / STD). */
  packagesFull: number
  /** N mod STD — the real decision is about this. */
  remainder: number
  /** Extra pieces if the remainder is rounded up to one more package. */
  excess: number
  /** excess × price; null when the group has no usable price. */
  parkedMoney: number | null
  /** excess / std. */
  parkedPct: number
}

export function computeGroupMath(
  needed: number,
  std: number,
  unitPrice: number | null,
): PurchaseGroupMath {
  const packagesFull = Math.floor(needed / std)
  const remainder = needed % std
  const excess = remainder > 0 ? std - remainder : 0
  return {
    needed,
    std,
    unitPrice,
    packagesFull,
    remainder,
    excess,
    parkedMoney: unitPrice != null ? excess * unitPrice : null,
    parkedPct: excess / std,
  }
}

export type PurchaseChoice = 'wholesale' | 'mixed' | 'retail'

export type RecommendationType =
  | 'wholesale_exact' // exact package fit: nothing to decide
  | 'mixed' // the remainder parks too much money → buy it retail
  | 'review' // high parked % under the money threshold → the user decides
  | 'wholesale_rounded' // cheap excess → round up to the extra package

export interface PurchaseRecommendation {
  type: RecommendationType
  /** null on 'review': the user must decide. */
  suggested: PurchaseChoice | null
  /** Suggested split; on 'review' the mixed one, as reference. */
  packagesWholesale: number
  qtyRetail: number
}

/** Decides on the REMAINDER: parked money (>, strict) before parked % (≥, inclusive); with no price
 *  only the % applies (ADR-018 §4). */
export function recommendPurchase(
  math: PurchaseGroupMath,
  thresholds: PurchaseThresholds,
): PurchaseRecommendation {
  if (math.remainder === 0) {
    return {
      type: 'wholesale_exact',
      suggested: 'wholesale',
      packagesWholesale: math.packagesFull,
      qtyRetail: 0,
    }
  }

  if (math.parkedMoney != null && math.parkedMoney > thresholds.money) {
    return {
      type: 'mixed',
      // With 0 full packages, mixed IS pure retail — name it so.
      suggested: math.packagesFull > 0 ? 'mixed' : 'retail',
      packagesWholesale: math.packagesFull,
      qtyRetail: math.remainder,
    }
  }

  if (math.parkedPct >= thresholds.pct) {
    return {
      type: 'review',
      suggested: null,
      packagesWholesale: math.packagesFull,
      qtyRetail: math.remainder,
    }
  }

  return {
    type: 'wholesale_rounded',
    suggested: 'wholesale',
    packagesWholesale: math.packagesFull + 1,
    qtyRetail: 0,
  }
}

/** wholesale = round up to packages; mixed = floor + remainder; retail = everything retail. */
export function applyChoice(
  math: PurchaseGroupMath,
  choice: PurchaseChoice,
): { packagesWholesale: number; qtyRetail: number } {
  switch (choice) {
    case 'wholesale':
      return {
        packagesWholesale: math.remainder > 0 ? math.packagesFull + 1 : math.packagesFull,
        qtyRetail: 0,
      }
    case 'mixed':
      return { packagesWholesale: math.packagesFull, qtyRetail: math.remainder }
    case 'retail':
      return { packagesWholesale: 0, qtyRetail: math.needed }
  }
}

export interface PurchasePlanTotals {
  /** Pieces left over from rounding up, per the decisions ALREADY made. */
  parkedPieces: number
  /** Money in those pieces; groups without a price add nothing. */
  parkedMoney: number
  /** Groups parking money (wholesale with a remainder). */
  parkedGroups: number
  /** Pieces spared from parking by buying the remainder retail. */
  savedPieces: number
  /** Money spared against rounding everything up. */
  savedMoney: number
  savedGroups: number
  /** Packages and pieces going to URREA. */
  wholesalePackages: number
  wholesalePieces: number
  /** Pieces going retail: remainders + full retail groups. */
  retailPieces: number
  /** Groups still undecided ("Revisar"). */
  undecidedGroups: number
}

const EMPTY_TOTALS: PurchasePlanTotals = {
  parkedPieces: 0, parkedMoney: 0, parkedGroups: 0,
  savedPieces: 0, savedMoney: 0, savedGroups: 0,
  wholesalePackages: 0, wholesalePieces: 0, retailPieces: 0,
  undecidedGroups: 0,
}

/** Only DECIDED groups count: "parked" = wholesale with a remainder, "saved" = its retail mirror (ADR-018). */
export function summarizePlanDecisions(
  groups: readonly PurchaseGroupPlan[],
  choiceOf: (group: PurchaseGroupPlan) => PurchaseChoice | null,
): PurchasePlanTotals {
  const totals = { ...EMPTY_TOTALS }

  for (const group of groups) {
    const math = group.math
    if (!math) continue // 'local' bucket: no STD, nothing to aggregate

    const choice = choiceOf(group)
    if (!choice) {
      totals.undecidedGroups++
      continue
    }

    const { packagesWholesale, qtyRetail } = applyChoice(math, choice)
    totals.wholesalePackages += packagesWholesale
    totals.wholesalePieces += packagesWholesale * math.std
    totals.retailPieces += qtyRetail

    if (math.remainder === 0) continue // exact fit: no excess at stake

    const money = math.parkedMoney ?? 0
    if (choice === 'wholesale') {
      totals.parkedPieces += math.excess
      totals.parkedMoney += money
      totals.parkedGroups++
    } else {
      totals.savedPieces += math.excess
      totals.savedMoney += money
      totals.savedGroups++
    }
  }

  return totals
}

/** Stale when need, STD or catalog membership changed — the Excel never uses old multiples silently. */
export function isDecisionStale(
  decision: Pick<OrderPurchaseDecision, 'needed_qty' | 'std_snapshot'>,
  currentNeeded: number,
  currentStd: number | null,
): boolean {
  if (decision.needed_qty !== currentNeeded) return true
  if (currentStd == null || decision.std_snapshot !== currentStd) return true
  return false
}

export type PurchaseBucket =
  | 'urrea' // in catalog and priced → full math + recommendation
  | 'no_data' // in catalog but with no usable price → % rule only
  | 'local' // not in the catalog → local purchase, no math

export interface PurchaseGroupPlan {
  key: string
  modelCode: string
  brand: string
  bucket: PurchaseBucket
  catalogDescription: string | null
  /** Catalog STD; null in the 'local' bucket. */
  std: number | null
  needed: number
  unitPrice: number | null
  lines: PurchaseSourceLine[]
  /** null in the 'local' bucket: no STD, no math. */
  math: PurchaseGroupMath | null
  /** null in the 'local' bucket. */
  recommendation: PurchaseRecommendation | null
  /** Saved decision for THIS order, if any. */
  decision: (OrderPurchaseDecision & { isStale: boolean }) | null
}

export interface PurchasePlan {
  /** Groups carrying math (urrea/no_data) first, then local. */
  groups: PurchaseGroupPlan[]
  /** Saved decisions whose group no longer exists in the order; cleared on re-save. */
  orphanDecisions: OrderPurchaseDecision[]
  thresholds: PurchaseThresholds
  summary: {
    urrea: number
    noData: number
    local: number
    decided: number
    stale: number
  }
}

/** consolidate → buckets → math + recommendation → match saved decisions (with staleness). */
export function buildPurchasePlan(
  items: PlannableItem[],
  catalog: Map<string, CatalogEntry>,
  decisions: OrderPurchaseDecision[],
  thresholds: PurchaseThresholds,
): PurchasePlan {
  const consolidated = consolidateOrderItems(items)
  const decisionByKey = new Map(
    decisions.map((d) => [catalogKey(d.model_code, d.brand), d]),
  )

  const withMath: PurchaseGroupPlan[] = []
  const local: PurchaseGroupPlan[] = []
  const summary = { urrea: 0, noData: 0, local: 0, decided: 0, stale: 0 }

  for (const group of consolidated) {
    const entry = catalog.get(group.key) ?? null
    // Defensive: an invalid std must never divide by zero — treated as "not in catalog".
    const std = entry && entry.std > 0 ? entry.std : null

    let bucket: PurchaseBucket
    let math: PurchaseGroupMath | null = null
    let recommendation: PurchaseRecommendation | null = null

    if (std != null) {
      bucket = group.unitPrice != null ? 'urrea' : 'no_data'
      math = computeGroupMath(group.needed, std, group.unitPrice)
      recommendation = recommendPurchase(math, thresholds)
    } else {
      bucket = 'local'
    }

    const saved = decisionByKey.get(group.key) ?? null
    const decision = saved
      ? { ...saved, isStale: isDecisionStale(saved, group.needed, std) }
      : null
    if (saved) decisionByKey.delete(group.key)

    const plan: PurchaseGroupPlan = {
      key: group.key,
      modelCode: group.modelCode,
      brand: group.brand,
      bucket,
      catalogDescription: entry?.description ?? null,
      std,
      needed: group.needed,
      unitPrice: group.unitPrice,
      lines: group.lines,
      math,
      recommendation,
      decision,
    }

    if (bucket === 'local') {
      summary.local++
      local.push(plan)
    } else {
      summary[bucket === 'urrea' ? 'urrea' : 'noData']++
      withMath.push(plan)
    }
    if (decision) {
      summary.decided++
      if (decision.isStale) summary.stale++
    }
  }

  return {
    groups: [...withMath, ...local],
    orphanDecisions: [...decisionByKey.values()],
    thresholds,
    summary,
  }
}
