/**
 * Planificador de compra: mayoreo (URREA) vs menudeo (proveedores locales).
 *
 * Lógica pura del ADR-018. La decisión NUNCA es global del producto: la
 * recomendación se recalcula al vuelo con las cantidades de CADA orden, y lo
 * que se persiste (`order_purchase_decisions`) es la decisión del usuario para
 * esa orden concreta.
 *
 * Reglas clave:
 * - "Pedible a URREA" ⇔ existe en `urrea_catalog` por `catalogKey(model_code,
 *   brand)` (cualquier línea del catálogo: URREA, SURTEK, FOY...). Reemplaza
 *   al viejo filtro `brand === 'URREA'`.
 * - La matemática corre SIEMPRE sobre cantidades consolidadas por grupo
 *   (líneas duplicadas entre secciones se suman): 5+5 con STD=10 es un paquete
 *   exacto, no dos restos del 50%.
 * - La decisión real es sobre el RESTO (`N mod STD`): los paquetes completos
 *   casi siempre convienen en mayoreo → pedido mixto permitido.
 * - Precio del grupo = promedio ponderado por cantidad de las líneas con
 *   precio > 0 (0 = "sin capturar", se excluye — incluirlo subestimaría el
 *   dinero parado). Es el precio de VENTA como proxy del costo (ADR-018 §4):
 *   sobreestima pero es proporcional.
 */

import type { OrderPurchaseDecision } from '@/types/database'
import {
  catalogKey,
  isProductItem,
  normalizeCatalogBrand,
  normalizeCatalogCode,
} from '@/lib/business-rules'

// ─── Umbrales configurables ────────────────────────────────────────────

export interface PurchaseThresholds {
  /** Dinero parado (MXN) a partir del cual el resto conviene a menudeo. */
  money: number
  /** Fracción del paquete extra que quedaría parada a partir de la cual se pide revisión. */
  pct: number
}

export const DEFAULT_PURCHASE_THRESHOLDS: PurchaseThresholds = { money: 100, pct: 0.8 }

export const SETTING_THRESHOLD_MONEY = 'purchase_threshold_money'
export const SETTING_THRESHOLD_PCT = 'purchase_threshold_pct'

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Merge de filas crudas de `app_settings` con los defaults. Valores inválidos
 * (no numéricos, ≤ 0, pct > 1) caen al default — la config nunca rompe el plan.
 */
export function resolveThresholds(settings: Record<string, unknown>): PurchaseThresholds {
  const money = asFiniteNumber(settings[SETTING_THRESHOLD_MONEY])
  const pct = asFiniteNumber(settings[SETTING_THRESHOLD_PCT])
  return {
    money: money != null && money > 0 ? money : DEFAULT_PURCHASE_THRESHOLDS.money,
    pct: pct != null && pct > 0 && pct <= 1 ? pct : DEFAULT_PURCHASE_THRESHOLDS.pct,
  }
}

// ─── Entradas ──────────────────────────────────────────────────────────

/** Subset estructural de OrderItem que necesita el planificador. */
export interface PlannableItem {
  id: string
  item_type?: string | null
  etm: string | null
  model_code: string
  brand: string
  section_label?: string | null
  quantity_to_order: number
  unit_price: number
}

/** Fila del catálogo URREA relevante para el plan (ver fetchCatalogEntryMap). */
export interface CatalogEntry {
  std: number
  description: string | null
}

// ─── Consolidación ─────────────────────────────────────────────────────

/** Línea original de la orden que alimenta un grupo (para la vista expandible). */
export interface PurchaseSourceLine {
  itemId: string
  etm: string | null
  sectionLabel: string | null
  /** model_code tal como está en la orden (crudo — puede diferir del normalizado). */
  modelCodeRaw: string
  quantityToOrder: number
  unitPrice: number
}

export interface ConsolidatedGroup {
  /** catalogKey(model_code, brand); las líneas sin model_code no se fusionan entre sí. */
  key: string
  modelCode: string // normalizado
  brand: string // normalizado
  /** Σ quantity_to_order de las líneas del grupo. */
  needed: number
  /** Promedio ponderado por cantidad de las líneas con precio > 0; null si ninguna lo tiene. */
  unitPrice: number | null
  lines: PurchaseSourceLine[]
}

/**
 * Agrupa los ítems a pedir por `catalogKey(model_code, brand)`. Solo productos
 * (separadores fuera) con `quantity_to_order > 0`. Orden estable por primera
 * aparición. Ítems SIN model_code no pueden cruzar con el catálogo ni fusionarse
 * con seguridad entre sí → cada uno queda como grupo propio (bucket local).
 */
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

// ─── Matemática de decisión ────────────────────────────────────────────

export interface PurchaseGroupMath {
  needed: number
  std: number
  unitPrice: number | null
  /** Paquetes completos que caben en la necesidad: floor(N / STD). */
  packagesFull: number
  /** Piezas que no llenan un paquete: N mod STD. La decisión real es sobre esto. */
  remainder: number
  /** Piezas excedentes si el resto se redondea a un paquete extra. */
  excess: number
  /** excedente × precio; null cuando el grupo no tiene precio utilizable. */
  parkedMoney: number | null
  /** Fracción del paquete extra que quedaría parada: excess / std. */
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

// ─── Recomendación ─────────────────────────────────────────────────────

/** Opciones de decisión del usuario por grupo. */
export type PurchaseChoice = 'wholesale' | 'mixed' | 'retail'

export type RecommendationType =
  | 'wholesale_exact' // encaja exacto en paquetes: no hay nada que decidir
  | 'mixed' // el resto deja demasiado dinero parado → resto a menudeo
  | 'review' // % parado alto con dinero bajo el umbral → decide el usuario
  | 'wholesale_rounded' // el excedente es barato → redondear al paquete extra

export interface PurchaseRecommendation {
  type: RecommendationType
  /** Elección sugerida; null en 'review' (el usuario debe decidir). */
  suggested: PurchaseChoice | null
  /** Reparto sugerido (en 'review': el mixto, como referencia). */
  packagesWholesale: number
  qtyRetail: number
}

/**
 * Recomienda qué hacer con el RESTO del grupo (ADR-018 §4). Precedencia:
 * dinero parado (> umbral, estricto) antes que % parado (≥ umbral, inclusivo).
 * Sin precio (parkedMoney null) la regla de dinero se salta y solo aplica el %.
 */
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
      // Con 0 paquetes completos el mixto ES menudeo puro — nombrarlo como tal.
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

/**
 * Traduce una elección del usuario a cantidades:
 * wholesale → ceil(N/STD) paquetes, 0 menudeo (redondea al paquete extra);
 * mixed → floor(N/STD) paquetes + resto a menudeo (cobertura exacta);
 * retail → 0 paquetes, N piezas a menudeo.
 */
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

// ─── Staleness ─────────────────────────────────────────────────────────

/**
 * Una decisión guardada queda desactualizada si cambió la necesidad
 * consolidada (editaron "A pedir") o el STD del catálogo (reimport). También
 * si el grupo ya no cruza con el catálogo (`currentStd` null) — la base de la
 * decisión desapareció. Nunca se genera el Excel URREA con múltiplos viejos
 * sin avisar.
 */
export function isDecisionStale(
  decision: Pick<OrderPurchaseDecision, 'needed_qty' | 'std_snapshot'>,
  currentNeeded: number,
  currentStd: number | null,
): boolean {
  if (decision.needed_qty !== currentNeeded) return true
  if (currentStd == null || decision.std_snapshot !== currentStd) return true
  return false
}

// ─── Armado del plan ───────────────────────────────────────────────────

export type PurchaseBucket =
  | 'urrea' // en catálogo, con precio → math + recomendación completas
  | 'no_data' // en catálogo pero sin precio utilizable → solo regla de %
  | 'local' // no está en el catálogo → compra local directa, sin math

export interface PurchaseGroupPlan {
  key: string
  modelCode: string
  brand: string
  bucket: PurchaseBucket
  catalogDescription: string | null
  /** STD del catálogo; null en bucket 'local'. */
  std: number | null
  needed: number
  unitPrice: number | null
  lines: PurchaseSourceLine[]
  /** null en bucket 'local' (sin STD no hay matemática). */
  math: PurchaseGroupMath | null
  /** null en bucket 'local'. */
  recommendation: PurchaseRecommendation | null
  /** Decisión guardada para ESTA orden, si existe. */
  decision: (OrderPurchaseDecision & { isStale: boolean }) | null
}

export interface PurchasePlan {
  /** Grupos en orden de aparición: primero los que llevan math (urrea/no_data), luego local. */
  groups: PurchaseGroupPlan[]
  /** Decisiones guardadas cuyo grupo ya no existe en la orden (se limpian al re-guardar). */
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

/**
 * Arma el plan completo de una orden: consolida, clasifica en buckets, calcula
 * math + recomendación y casa las decisiones guardadas (con staleness).
 *
 * @param catalog  Map<catalogKey, CatalogEntry> (ver fetchCatalogEntryMap)
 */
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
    // Defensivo: la columna std es NOT NULL CHECK > 0, pero un valor inválido
    // no debe producir divisiones entre cero — se trata como "sin catálogo".
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
