/** Purchase planner (ADR-018), read (#109): the same plan the screen builds, digested. The write is purchase-write.ts. */

import type { Db } from '@/lib/mcp/core/db'
import { orderBrief, resolveOrder } from './orders'
import { loadPurchasePlan } from '@/lib/purchase-decisions-store'
import { choiceOf, PURCHASE_CHOICE_TOKENS, type PurchaseGroupPlan } from '@/lib/purchase-plan'

const BUCKET_LABELS = { urrea: 'catálogo', no_data: 'catálogo sin precio', local: 'compra local' } as const

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
          sugerido: g.recommendation.suggested ? PURCHASE_CHOICE_TOKENS.toToken(g.recommendation.suggested) : 'revisar (decide el usuario)',
          paquetes_mayoreo: g.recommendation.packagesWholesale,
          piezas_menudeo: g.recommendation.qtyRetail,
        }
      : null,
    decision_guardada: g.decision
      ? {
          eleccion: PURCHASE_CHOICE_TOKENS.toToken(choiceOf(g.decision)),
          paquetes_mayoreo: g.decision.packages_wholesale,
          piezas_menudeo: g.decision.qty_retail,
          desactualizada: g.decision.isStale,
        }
      : null,
  }
}

export async function getPurchasePlan(db: Db, input: { orden: string }) {
  const order = await resolveOrder(db, input.orden)
  const { plan } = await loadPurchasePlan(db, order.id)
  const { thresholds } = plan

  return {
    orden: orderBrief(order),
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
