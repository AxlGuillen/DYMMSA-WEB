/**
 * save_purchase_decisions (#155 D, ADR-018): wholesale / mixed / retail per group of an order. The tool never takes
 * numbers: only the choice. STD and need come from the plan the server builds, the split from applyChoice, and the
 * set sent is always the complete one (the save is replace-all, so a partial set would delete the rest). A group that
 * stays undecided blocks the save, as it does on the screen.
 */

import type { WritePlan } from '@/lib/mcp/core/define'
import { orderBrief, resolveOrder } from './orders'
import { writeResult, type Changes } from '@/lib/mcp/core/envelope'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import { normalizeCatalogBrand, normalizeCatalogCode } from '@/lib/business-rules'
import { buildDecisionSet, assertOrderOpen, decidableGroups, loadPurchasePlan, savePurchaseDecisions } from '@/lib/purchase-decisions-store'
import {
  applyChoice,
  choiceOf,
  PURCHASE_CHOICE_TOKENS,
  summarizePlanDecisions,
  type PurchaseChoice,
  type PurchaseGroupPlan,
} from '@/lib/purchase-plan'

export interface SavePurchaseDecisionsInput {
  orden: string
  decisiones?: { codigo: string; marca?: string; eleccion: string }[]
  aceptar_recomendaciones?: true
}

type Carry = { orderId: string; rows: ReturnType<typeof buildDecisionSet>['rows'] }

const groupLabel = (g: Pick<PurchaseGroupPlan, 'modelCode' | 'brand'>) => `${g.modelCode} (${g.brand})`

/** Which group a `codigo` (and `marca`) names among the ones that take a decision; several brands ask for `marca`. */
function findGroup(plan: ReturnType<typeof decidableGroups>, all: readonly PurchaseGroupPlan[], codigo: string, marca?: string): PurchaseGroupPlan {
  const code = normalizeCatalogCode(codigo)
  const brand = marca === undefined ? undefined : normalizeCatalogBrand(marca)
  const named = (g: PurchaseGroupPlan) => g.modelCode === code && (brand === undefined || g.brand === brand)
  const matches = plan.filter(named)
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new ToolError(`El código ${code} está en varias marcas (${matches.map((g) => g.brand).join(', ')}): indica \`marca\`.`)
  if (all.some(named)) throw new ToolError(`El ${code} va a compra local (no está en el catálogo URREA): no lleva decisión de mayoreo o menudeo.`)
  throw new ToolError(`La orden no trae ${code}${brand ? ` de ${brand}` : ''}. Los grupos con decisión son: ${plan.map(groupLabel).join(', ') || 'ninguno'}.`)
}

const splitView = (choice: PurchaseChoice, split: { packagesWholesale: number; qtyRetail: number }) => ({
  eleccion: PURCHASE_CHOICE_TOKENS.toToken(choice),
  paquetes_mayoreo: split.packagesWholesale,
  piezas_menudeo: split.qtyRetail,
})

export async function planSavePurchaseDecisions(db: Db, input: SavePurchaseDecisionsInput): Promise<WritePlan<Carry>> {
  if (!input.decisiones?.length && !input.aceptar_recomendaciones) {
    throw new ToolError('Indica `decisiones` (codigo y eleccion) o `aceptar_recomendaciones: true`.')
  }
  const order = await resolveOrder(db, input.orden)
  await assertOrderOpen(db, order.id)
  const { plan } = await loadPurchasePlan(db, order.id)
  const groups = decidableGroups(plan)
  if (groups.length === 0) throw new ToolError('La orden no tiene grupos del catálogo URREA que decidir: lo demás va a compra local.')

  const explicit = new Map<string, PurchaseChoice>()
  for (const decision of input.decisiones ?? []) {
    const choice = PURCHASE_CHOICE_TOKENS.toDb(decision.eleccion)
    if (!choice) throw new ToolError(`Elección inválida "${decision.eleccion}": usa ${PURCHASE_CHOICE_TOKENS.tokens.join(' | ')}`)
    const group = findGroup(groups, plan.groups, decision.codigo, decision.marca)
    if (explicit.has(group.key)) throw new ToolError(`El ${groupLabel(group)} viene dos veces en \`decisiones\`.`)
    explicit.set(group.key, choice)
  }

  const set = buildDecisionSet(plan, explicit, input.aceptar_recomendaciones === true)
  const bloqueos: string[] = []
  if (set.undecided.length > 0) {
    bloqueos.push(
      `Quedan ${set.undecided.length} grupos sin decidir: ${set.undecided.map((g) => `${groupLabel(g)}${g.recommendation?.suggested ? '' : ' [revisar]'}`).join(', ')}. Elige mayoreo, mixto o menudeo para cada uno${input.aceptar_recomendaciones ? '' : ', o pide `aceptar_recomendaciones`'}; los «revisar» siempre los decide el usuario.`,
    )
  }

  // Per changed group: the saved choice and split against the new ones (a stale one counts as changed: it is re-applied).
  const cambios: Record<string, { antes: unknown; ahora: unknown }> = {}
  const shown: unknown[] = []
  let unchanged = 0
  for (const group of groups) {
    const choice = set.choices.get(group.key)
    if (!choice) continue
    const split = applyChoice(group.math!, choice)
    const saved = group.decision
    const same = saved && !saved.isStale && saved.packages_wholesale === split.packagesWholesale && saved.qty_retail === split.qtyRetail
    if (same) {
      unchanged++
      continue
    }
    const ahora = splitView(choice, split)
    cambios[groupLabel(group)] = {
      antes: saved ? { ...splitView(choiceOf(saved), { packagesWholesale: saved.packages_wholesale, qtyRetail: saved.qty_retail }), ...(saved.isStale ? { desactualizada: true } : {}) } : null,
      ahora,
    }
    shown.push({ codigo: group.modelCode, marca: group.brand, necesita: group.needed, std: group.std, ...ahora })
  }

  const totals = summarizePlanDecisions(plan.groups, (g) => set.choices.get(g.key) ?? null)
  const avisos: string[] = []
  if (unchanged > 0) avisos.push(`${unchanged} grupo${unchanged === 1 ? '' : 's'} se queda${unchanged === 1 ? '' : 'n'} como está guardado.`)
  if (plan.orphanDecisions.length > 0) avisos.push(`Se limpian ${plan.orphanDecisions.length} decisiones huérfanas (de grupos que ya no están en la orden).`)
  if (!input.aceptar_recomendaciones && set.rows.length < groups.length) avisos.push('Solo cuentan los grupos decididos; el resto no entra al total.')

  return {
    entity: {
      key: 'decisiones',
      value: {
        orden: orderBrief(order),
        grupos: shown,
        total: {
          paquetes_a_urrea: totals.wholesalePackages,
          piezas_a_urrea: totals.wholesalePieces,
          piezas_a_menudeo: totals.retailPieces,
          dinero_parado_mxn: Math.round(totals.parkedMoney * 100) / 100,
          dinero_ahorrado_mxn: Math.round(totals.savedMoney * 100) / 100,
        },
      },
    },
    cambios: cambios as Changes,
    avisos,
    bloqueos: bloqueos.length > 0 ? bloqueos : undefined,
    sinCambios: Object.keys(cambios).length === 0 && plan.orphanDecisions.length === 0 && bloqueos.length === 0,
    // What each group needs and has saved, the thresholds the recommendation used, and the orphans: any of them moving voids the key.
    fingerprint: {
      orden: order.id,
      umbrales: plan.thresholds,
      grupos: groups.map((g) => [g.key, g.needed, g.std, g.recommendation?.suggested ?? null, g.decision ? [g.decision.packages_wholesale, g.decision.qty_retail, g.decision.std_snapshot, g.decision.needed_qty] : null]),
      huerfanas: plan.orphanDecisions.map((d) => d.id).sort(),
    },
    subject: `Las decisiones de compra de ${order.name}`,
    carry: { orderId: order.id, rows: set.rows },
  }
}

export async function commitSavePurchaseDecisions(db: Db, plan: WritePlan<Carry>) {
  const saved = await savePurchaseDecisions(db, plan.carry.orderId, plan.carry.rows)
  return writeResult('actualizado', 'decisiones', { ...(plan.entity.value as object), guardadas: saved.length }, { cambios: plan.cambios, avisos: plan.avisos })
}
