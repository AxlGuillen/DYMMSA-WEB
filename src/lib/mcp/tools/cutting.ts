/** Cut module (ADR-022): net needs per group and bars/sheets per captured presentation (#109); save_material_presentation (#134). */

import { ToolError, type Db } from '../shared'
import { resolveOrder } from './orders'
import {
  formatMm,
  packBars,
  packSheets,
  parsePresentationInput,
  plateNetNeeds,
  PRESENTATION_KEY,
  resolveCutMargin,
  SETTING_CUT_MARGIN_MM,
  tubeNetNeeds,
  type PlatePieceInput,
  type PresentationRow,
  type TubePieceInput,
} from '@/lib/cut-plan'
import type { CutPlanPiece, MaterialPresentation } from '@/types/database'

/** Postgres numerics arrive as strings from supabase-js; coerce at the boundary, never in the lib. */
function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const impossible = (rows: { pieceId: string; lengthMm: number; quantity: number }[]) =>
  rows.map((r) => ({ pieza: r.pieceId, largo_mm: r.lengthMm, cantidad: r.quantity }))

export async function getCutPlan(db: Db, input: { orden: string }) {
  const order = await resolveOrder(db, input.orden)
  const [piecesRes, presentationsRes, settingsRes] = await Promise.all([
    db.from('cut_plan_pieces').select('*').eq('order_id', order.id).order('sort_order', { ascending: true }),
    db.from('material_presentations').select('*').order('last_used_at', { ascending: false }),
    db.from('app_settings').select('key, value').eq('key', SETTING_CUT_MARGIN_MM),
  ])
  if (piecesRes.error) throw new ToolError(`Error al leer la lista de corte: ${piecesRes.error.message}`)
  const pieces = (piecesRes.data ?? []) as CutPlanPiece[]
  const presentations = (presentationsRes.data ?? []) as MaterialPresentation[]
  const margin = resolveCutMargin(
    Object.fromEntries(((settingsRes.data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value])),
  )

  const tubes: TubePieceInput[] = pieces
    .filter((p) => p.material_type === 'tube')
    .map((p) => ({ id: p.id, diameterMm: num(p.diameter_mm), lengthMm: num(p.length_mm), quantity: p.quantity }))
  const plates: PlatePieceInput[] = pieces
    .filter((p) => p.material_type === 'plate')
    .map((p) => ({
      id: p.id,
      thicknessMm: num(p.thickness_mm),
      widthMm: num(p.width_mm),
      lengthMm: num(p.length_mm),
      quantity: p.quantity,
    }))
  const labelOf = new Map(pieces.map((p) => [p.id, p.requested_label]))
  const pieceRow = (p: { id: string; lengthMm: number; quantity: number }) => ({
    largo_mm: p.lengthMm,
    cantidad: p.quantity,
    pedido_como: labelOf.get(p.id) ?? null,
  })

  return {
    orden: { id: order.id, nombre: order.name, cliente: order.customer_name, estado: order.status },
    margen_por_corte_mm: margin,
    nota: pieces.length === 0 ? 'La orden no tiene lista de corte capturada.' : null,
    tubos: tubeNetNeeds(tubes, margin).map((g) => ({
      diametro_mm: g.diameterMm,
      unidades: g.totalUnits,
      largo_neto_mm: g.netLengthMm,
      piezas: g.pieces.map(pieceRow),
      // One packing per captured bar length of this diameter: "3 barras de 6 m".
      opciones: presentations
        .filter((pr) => pr.material_type === 'tube' && num(pr.diameter_mm) === g.diameterMm)
        .map((pr) => {
          const packed = packBars(g.pieces, num(pr.length_mm), margin)
          return {
            barra_mm: num(pr.length_mm),
            barras: packed.bars.length,
            sobrante_total_mm: packed.bars.reduce((sum, b) => sum + b.leftoverMm, 0),
            no_caben: impossible(packed.impossible),
          }
        }),
    })),
    placas: plateNetNeeds(plates).map((g) => ({
      espesor_mm: g.thicknessMm,
      unidades: g.totalUnits,
      area_neta_mm2: g.areaMm2,
      ancho_minimo_mm: g.minWidthMm,
      piezas: g.pieces.map((p) => ({ ...pieceRow(p), ancho_mm: p.widthMm })),
      // Sheets of this thickness, rotation allowed as the planner defaults to (#81).
      opciones: presentations
        .filter((pr) => pr.material_type === 'plate' && num(pr.thickness_mm) === g.thicknessMm && pr.width_mm && pr.length_mm)
        .map((pr) => {
          const packed = packSheets(g.pieces, num(pr.width_mm), num(pr.length_mm), margin, { allowRotation: true })
          return {
            hoja: `${num(pr.width_mm)}×${num(pr.length_mm)} mm`,
            hojas: packed.sheets.length,
            no_caben: impossible(packed.impossible),
          }
        }),
    })),
  }
}

export interface SaveMaterialPresentationInput {
  tipo: 'tubo' | 'placa'
  diametro_mm?: number
  espesor_mm?: number
  ancho_mm?: number
  largo_mm: number
}

const describePresentation = (p: PresentationRow) =>
  p.material_type === 'tube'
    ? `Barra de tubo de ${formatMm(num(p.diameter_mm))} de diámetro, ${formatMm(num(p.length_mm))} de largo`
    : `Hoja de placa de ${formatMm(num(p.thickness_mm))} de espesor, ${num(p.width_mm)} × ${num(p.length_mm)} mm`

/** Registers a supplier presentation with the route's rules and upsert key; deleting a wrong one stays in the app (#134). */
export async function saveMaterialPresentation(db: Db, input: SaveMaterialPresentationInput) {
  const parsed = parsePresentationInput({
    material_type: input.tipo === 'tubo' ? 'tube' : input.tipo === 'placa' ? 'plate' : input.tipo,
    diameter_mm: input.diametro_mm,
    thickness_mm: input.espesor_mm,
    width_mm: input.ancho_mm,
    length_mm: input.largo_mm,
  })
  if ('error' in parsed) throw new ToolError(parsed.error)
  const row = parsed.value

  // Same identity as the UNIQUE NULLS NOT DISTINCT, so the answer can say whether it already existed.
  let lookup = db.from('material_presentations').select('id')
  for (const column of PRESENTATION_KEY.split(',') as (keyof PresentationRow)[]) {
    lookup = row[column] === null ? lookup.is(column, null) : lookup.eq(column, row[column])
  }
  const { data: existing, error: lookupError } = await lookup.limit(1).maybeSingle()
  if (lookupError) throw new ToolError(`Error al leer las medidas: ${lookupError.message}`)

  const { error } = await db
    .from('material_presentations')
    .upsert({ ...row, last_used_at: new Date().toISOString() }, { onConflict: PRESENTATION_KEY })
  if (error) throw new ToolError(`Error al guardar la presentación: ${error.message}`)
  return {
    accion: existing ? 'ya_existia' : 'registrada',
    presentacion: describePresentation(row),
    nota: existing
      ? 'Ya estaba registrada; quedó como la más reciente.'
      : 'Registrada: get_cut_plan ya calcula con ella cuántas barras u hojas salen. Una medida errónea se borra en la app (Medidas de material).',
  }
}
