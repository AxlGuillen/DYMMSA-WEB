/** Purchase planner (ADR-018), read-only (#109): the same plan the screen builds, digested. */

import { ToolError, type Db } from '../shared'
import { resolveOrder } from './orders'
import { fetchCatalogEntryMap } from '@/lib/urrea-catalog'
import {
  buildPurchasePlan,
  resolveThresholds,
  SETTING_THRESHOLD_MONEY,
  SETTING_THRESHOLD_PCT,
  type PlannableItem,
  type PurchaseChoice,
  type PurchaseGroupPlan,
} from '@/lib/purchase-plan'
import type { OrderPurchaseDecision } from '@/types/database'

const BUCKET_LABELS = { urrea: 'catálogo', no_data: 'catálogo sin precio', local: 'compra local' } as const
const CHOICE_LABELS: Record<PurchaseChoice, string> = { wholesale: 'mayoreo', mixed: 'mixto', retail: 'menudeo' }

function choiceOf(d: Pick<OrderPurchaseDecision, 'packages_wholesale' | 'qty_retail'>): PurchaseChoice {
  if (d.qty_retail === 0) return 'wholesale'
  if (d.packages_wholesale === 0) return 'retail'
  return 'mixed'
}

function digestGroup(g: PurchaseGroupPlan) {
  return {
    codigo: g.modelCode,
    marca: g.brand,
    descripcion: g.catalogDescription,
    origen: BUCKET_LABELS[g.bucket],
    necesita: g.needed,
    std: g.std,
    precio_unitario: g.unitPrice,
    matematica: g.math
      ? {
          paquetes_completos: g.math.packagesFull,
          resto: g.math.remainder,
          excedente_si_redondea: g.math.excess,
          dinero_parado: g.math.parkedMoney,
          pct_parado: g.math.parkedPct,
        }
      : null,
    recomendacion: g.recommendation
      ? {
          tipo: g.recommendation.type,
          sugerido: g.recommendation.suggested ? CHOICE_LABELS[g.recommendation.suggested] : 'revisar (decide el usuario)',
          paquetes_mayoreo: g.recommendation.packagesWholesale,
          piezas_menudeo: g.recommendation.qtyRetail,
        }
      : null,
    decision_guardada: g.decision
      ? {
          eleccion: CHOICE_LABELS[choiceOf(g.decision)],
          paquetes_mayoreo: g.decision.packages_wholesale,
          piezas_menudeo: g.decision.qty_retail,
          desactualizada: g.decision.isStale,
        }
      : null,
  }
}

export async function getPurchasePlan(db: Db, input: { orden: string }) {
  const order = await resolveOrder(db, input.orden)
  const { data: items, error: itemsError } = await db
    .from('order_items')
    .select('id, item_type, etm, model_code, brand, description, section_label, quantity_to_order, unit_price')
    .eq('order_id', order.id)
    .limit(5000)
  if (itemsError) throw new ToolError(`Error al leer los productos de la orden: ${itemsError.message}`)
  const plannable = (items ?? []) as PlannableItem[]

  const [catalog, decisionsRes, settingsRes] = await Promise.all([
    fetchCatalogEntryMap(db, plannable.map((i) => i.model_code)),
    db.from('order_purchase_decisions').select('*').eq('order_id', order.id),
    db.from('app_settings').select('key, value').in('key', [SETTING_THRESHOLD_MONEY, SETTING_THRESHOLD_PCT]),
  ])
  if (decisionsRes.error) throw new ToolError(`Error al leer las decisiones de compra: ${decisionsRes.error.message}`)
  const thresholds = resolveThresholds(
    Object.fromEntries(((settingsRes.data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value])),
  )
  const plan = buildPurchasePlan(plannable, catalog, (decisionsRes.data ?? []) as OrderPurchaseDecision[], thresholds)

  return {
    orden: { id: order.id, nombre: order.name, cliente: order.customer_name, estado: order.status },
    umbrales: { dinero_parado_mxn: thresholds.money, pct_parado: thresholds.pct },
    resumen: {
      grupos_catalogo: plan.summary.urrea,
      grupos_sin_precio: plan.summary.noData,
      grupos_compra_local: plan.summary.local,
      decididos: plan.summary.decided,
      desactualizados: plan.summary.stale,
      decisiones_huerfanas: plan.orphanDecisions.length,
    },
    grupos: plan.groups.map(digestGroup),
  }
}
