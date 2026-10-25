/**
 * save_cut_plan (#155 D, ADR-022): the pieces of tube and plate DYMMSA has made for an order. The save is replace-all,
 * so the tool always sends the complete list: it reads the current one, applies agregar / quitar / reemplazar and
 * hands the whole to the same store as the route. Adding is direct; removing or replacing asks for the yes and says
 * how the net need changes. Millimetres only; pieces are numbered as get_cut_plan numbers them.
 */

import type { WritePlan } from '@/lib/mcp/core/define'
import { orderBrief, resolveOrder } from './orders'
import { writeResult, type Changes } from '@/lib/mcp/core/envelope'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import { formatMm, parseCutPieces, plateNetNeeds, resolveCutMargin, SETTING_CUT_MARGIN_MM, tubeNetNeeds, type CutPieceRow } from '@/lib/cut-plan'
import { loadCutPieces, saveCutPlan } from '@/lib/cut-plan-store'
import type { CutPlanPiece } from '@/types/database'

export const CUT_ACTIONS = ['agregar', 'quitar', 'reemplazar'] as const

export interface CutPieceInput {
  tipo: 'tubo' | 'placa'
  diametro_mm?: number
  espesor_mm?: number
  ancho_mm?: number
  largo_mm: number
  cantidad: number
  /** What the customer asked for, to record the match to the size used. */
  pedido_como?: string
}

export interface SaveCutPlanInput {
  orden: string
  accion: (typeof CUT_ACTIONS)[number]
  piezas?: CutPieceInput[]
  /** Positions in the list, as get_cut_plan numbers them. */
  quitar_piezas?: number[]
}

/** Postgres numerics arrive as strings from supabase-js; coerced here, at the boundary, never in the lib. */
const num = (value: unknown): number | null => (value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null)

/** A stored piece back as the route's body shape, keeping its origin line and label. */
const asInput = (p: CutPlanPiece): Record<string, unknown> => ({
  material_type: p.material_type,
  diameter_mm: num(p.diameter_mm),
  thickness_mm: num(p.thickness_mm),
  width_mm: num(p.width_mm),
  length_mm: num(p.length_mm),
  quantity: p.quantity,
  requested_label: p.requested_label,
  source_item_id: p.source_item_id,
})

const fromTool = (p: CutPieceInput): Record<string, unknown> => ({
  material_type: p.tipo === 'tubo' ? 'tube' : 'plate',
  diameter_mm: p.diametro_mm ?? null,
  thickness_mm: p.espesor_mm ?? null,
  width_mm: p.ancho_mm ?? null,
  length_mm: p.largo_mm,
  quantity: p.cantidad,
  requested_label: p.pedido_como ?? null,
  source_item_id: null,
})

const describe = (p: Record<string, unknown>) =>
  p.material_type === 'tube'
    ? `tubo de ${formatMm(Number(p.diameter_mm))} × ${formatMm(Number(p.length_mm))} × ${p.quantity}`
    : `placa de ${formatMm(Number(p.thickness_mm))} (ancho ${formatMm(Number(p.width_mm))}) × ${formatMm(Number(p.length_mm))} × ${p.quantity}`

/** Net need per diameter / thickness, as the assistant reads it: units and net length (tubes) or area (plates). */
function needs(rows: readonly Record<string, unknown>[], margin: number) {
  const tubes = rows.filter((r) => r.material_type === 'tube').map((r, i) => ({ id: `t${i}`, diameterMm: Number(r.diameter_mm), lengthMm: Number(r.length_mm), quantity: Number(r.quantity) }))
  const plates = rows.filter((r) => r.material_type === 'plate').map((r, i) => ({ id: `p${i}`, thicknessMm: Number(r.thickness_mm), widthMm: Number(r.width_mm), lengthMm: Number(r.length_mm), quantity: Number(r.quantity) }))
  const out: Record<string, unknown> = {}
  for (const g of tubeNetNeeds(tubes, margin)) out[`tubo ${formatMm(g.diameterMm)}`] = { unidades: g.totalUnits, largo_neto_mm: g.netLengthMm }
  for (const g of plateNetNeeds(plates)) out[`placa ${formatMm(g.thicknessMm)}`] = { unidades: g.totalUnits, area_neta_mm2: g.areaMm2 }
  return out
}

type Carry = { orderId: string; rows: Record<string, unknown>[] }

export async function planSaveCutPlan(db: Db, input: SaveCutPlanInput): Promise<WritePlan<Carry>> {
  const order = await resolveOrder(db, input.orden)
  if (['completed', 'cancelled'].includes(order.status)) throw new ToolError('Una orden completada o cancelada no se modifica.')

  const [current, settings] = await Promise.all([
    loadCutPieces(db, order.id),
    db.from('app_settings').select('key, value').eq('key', SETTING_CUT_MARGIN_MM),
  ])
  const margin = resolveCutMargin(Object.fromEntries(((settings.data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value])))
  const before = current.map(asInput)
  const added = (input.piezas ?? []).map(fromTool)
  const avisos: string[] = []
  let rows: Record<string, unknown>[]

  if (input.accion === 'agregar') {
    if (!added.length) throw new ToolError('Para agregar indica `piezas`.')
    if (input.quitar_piezas?.length) throw new ToolError('`quitar_piezas` va con la acción quitar; agregar y quitar son dos llamadas.')
    rows = [...before, ...added]
  } else if (input.accion === 'quitar') {
    const gone = [...new Set(input.quitar_piezas ?? [])]
    if (!gone.length) throw new ToolError('Para quitar indica `quitar_piezas` (los números de get_cut_plan).')
    if (added.length) throw new ToolError('`piezas` va con agregar o reemplazar; quitar y agregar son dos llamadas.')
    for (const n of gone) if (!Number.isInteger(n) || n < 1 || n > before.length) throw new ToolError(`No hay pieza ${n}: la lista tiene ${before.length}.`)
    rows = before.filter((_, i) => !gone.includes(i + 1))
    for (const n of gone.sort((a, b) => a - b)) avisos.push(`Sale la pieza ${n}: ${describe(before[n - 1])}.`)
  } else {
    if (input.quitar_piezas?.length) throw new ToolError('`quitar_piezas` va con la acción quitar.')
    rows = added
    avisos.push(`Reemplaza la lista completa: salen ${before.length} piezas${added.length === 0 ? ' y la lista queda vacía' : ` y entran ${added.length}`}.`)
  }

  // Same rules as the route, before anything is written: shape of each piece, in the list's own numbering.
  const parsed = parseCutPieces(rows)
  if ('error' in parsed) throw new ToolError(parsed.error)
  const final: CutPieceRow[] = parsed.value

  const netBefore = needs(before, margin)
  const netAfter = needs(rows, margin)
  const cambios: Changes = {
    piezas: { antes: before.length, ahora: rows.length },
    ...Object.fromEntries(
      [...new Set([...Object.keys(netBefore), ...Object.keys(netAfter)])]
        .filter((key) => JSON.stringify(netBefore[key]) !== JSON.stringify(netAfter[key]))
        .map((key) => [`necesidad ${key}`, { antes: netBefore[key] ?? null, ahora: netAfter[key] ?? null }]),
    ),
  }
  if (input.accion === 'agregar') for (const p of added) avisos.push(`Entra: ${describe(p)}.`)
  avisos.push(`Necesidad neta con margen de ${formatMm(margin)} por corte.`)

  return {
    entity: { key: 'lista_de_corte', value: { orden: orderBrief(order), piezas: final.map((row, i) => ({ pieza: i + 1, descripcion: describe(row as unknown as Record<string, unknown>), pedido_como: row.requested_label })) } },
    cambios,
    avisos,
    sinCambios: rows.length === before.length && JSON.stringify(rows) === JSON.stringify(before),
    directo: input.accion === 'agregar',
    // The pieces are re-inserted on every save (new ids), so a repeated key meets another fingerprint.
    fingerprint: { orden: order.id, piezas: current.map((p) => [p.id, p.sort_order, p.quantity, p.length_mm]) },
    subject: `La lista de corte de ${order.name}`,
    carry: { orderId: order.id, rows },
  }
}

export async function commitSaveCutPlan(db: Db, plan: WritePlan<Carry>) {
  const saved = await saveCutPlan(db, plan.carry.orderId, plan.carry.rows)
  return writeResult('actualizado', 'lista_de_corte', { ...(plan.entity.value as object), guardadas: saved.length }, { cambios: plan.cambios, avisos: plan.avisos })
}
