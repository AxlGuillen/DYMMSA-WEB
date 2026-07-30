import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, notFound, badRequest, serverError } from '@/lib/api-helpers'
import { resolveCutMargin, SETTING_CUT_MARGIN_MM } from '@/lib/cut-plan'
import type { CutMaterialType, CutPlanPieceInsert } from '@/types/database'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Los `numeric` de Postgres llegan como STRING por supabase-js; la matemática
 * de cut-plan.ts espera number. Se coerce AQUÍ, en la frontera — nunca en la lib.
 */
function num(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// GET /api/orders/[id]/cut-plan → { order, pieces, candidates, presentations, marginMm }
export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data: order } = await supabase
      .from('orders')
      .select('id, name, customer_name, status')
      .eq('id', id)
      .single()
    if (!order) return notFound('Orden no encontrada')

    const [piecesRes, itemsRes, presentationsRes, settingsRes] = await Promise.all([
      supabase
        .from('cut_plan_pieces')
        .select('*')
        .eq('order_id', id)
        .order('sort_order', { ascending: true }),
      // Candidatos: ítems DYMMSA de la orden (los que se mandan a hacer).
      supabase
        .from('order_items')
        .select('id, etm, description, quantity_approved, item_type, brand')
        .eq('order_id', id)
        .ilike('brand', 'dymmsa'),
      supabase
        .from('material_presentations')
        .select('*')
        .order('last_used_at', { ascending: false }),
      supabase.from('app_settings').select('key, value').eq('key', SETTING_CUT_MARGIN_MM),
    ])

    if (piecesRes.error) {
      console.error('cut-plan pieces error:', piecesRes.error)
      return serverError('Error al cargar la lista de corte')
    }

    // Medidas nominales del producto para PRE-LLENAR los candidatos.
    const candidateItems = (itemsRes.data ?? []).filter(
      (item) => !item.item_type || item.item_type === 'product',
    )
    const etms = [...new Set(candidateItems.map((item) => item.etm).filter(Boolean))]
    const { data: products } = etms.length
      ? await supabase
          .from('etm_products')
          .select('etm, cut_kind, cut_diameter_mm, cut_thickness_mm, cut_width_mm, cut_length_mm')
          .in('etm', etms)
      : { data: [] }
    const nominalByEtm = new Map((products ?? []).map((p) => [p.etm, p]))

    return NextResponse.json({
      order,
      pieces: (piecesRes.data ?? []).map((piece) => ({
        ...piece,
        diameter_mm: num(piece.diameter_mm),
        thickness_mm: num(piece.thickness_mm),
        width_mm: num(piece.width_mm),
        length_mm: num(piece.length_mm),
      })),
      candidates: candidateItems.map((item) => {
        const nominal = item.etm ? nominalByEtm.get(item.etm) : undefined
        return {
          itemId: item.id,
          etm: item.etm,
          description: item.description,
          quantity: item.quantity_approved,
          cutKind: (nominal?.cut_kind ?? null) as CutMaterialType | null,
          diameterMm: num(nominal?.cut_diameter_mm),
          thicknessMm: num(nominal?.cut_thickness_mm),
          widthMm: num(nominal?.cut_width_mm),
          lengthMm: num(nominal?.cut_length_mm),
        }
      }),
      presentations: (presentationsRes.data ?? []).map((p) => ({
        ...p,
        diameter_mm: num(p.diameter_mm),
        thickness_mm: num(p.thickness_mm),
        width_mm: num(p.width_mm),
        length_mm: num(p.length_mm),
      })),
      marginMm: resolveCutMargin(
        Object.fromEntries((settingsRes.data ?? []).map((row) => [row.key, row.value])),
      ),
    })
  } catch (error) {
    console.error('cut-plan GET error:', error)
    return serverError()
  }
}

interface PieceInput {
  material_type: CutMaterialType
  diameter_mm?: number | null
  thickness_mm?: number | null
  width_mm?: number | null
  length_mm: number
  quantity: number
  requested_label?: string | null
  source_item_id?: string | null
}

const isPositive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * PUT /api/orders/[id]/cut-plan — reemplaza la lista de corte COMPLETA (el
 * body es el estado deseado, como purchase-decisions). Las piezas no tienen
 * llave natural para un upsert, así que es delete → insert con RESTAURACIÓN
 * de las filas previas si el insert falla (no se pierde la lista por un error).
 */
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data: order } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', id)
      .single()
    if (!order) return notFound('Orden no encontrada')
    if (['completed', 'cancelled'].includes(order.status)) {
      return badRequest('No se puede modificar una orden completada o cancelada')
    }

    const body = (await request.json()) as { pieces?: PieceInput[] }
    if (!Array.isArray(body.pieces)) {
      return badRequest('El body debe incluir un array "pieces"')
    }

    const rows: CutPlanPieceInsert[] = []
    for (const [index, piece] of body.pieces.entries()) {
      const label = `Pieza ${index + 1}`
      if (piece.material_type !== 'tube' && piece.material_type !== 'plate') {
        return badRequest(`${label}: tipo de material inválido`)
      }
      if (!isPositive(piece.length_mm)) {
        return badRequest(`${label}: la longitud debe ser mayor a 0`)
      }
      if (!Number.isInteger(piece.quantity) || piece.quantity < 1) {
        return badRequest(`${label}: la cantidad debe ser un entero mayor a 0`)
      }
      // Espejo del CHECK cut_piece_shape, con mensaje claro (ADR-009).
      if (piece.material_type === 'tube') {
        if (!isPositive(piece.diameter_mm)) {
          return badRequest(`${label}: un tubo necesita diámetro`)
        }
        if (piece.width_mm != null || piece.thickness_mm != null) {
          return badRequest(`${label}: un tubo no lleva ancho ni espesor`)
        }
      } else {
        if (!isPositive(piece.thickness_mm) || !isPositive(piece.width_mm)) {
          return badRequest(`${label}: una placa necesita espesor y ancho`)
        }
        if (piece.diameter_mm != null) {
          return badRequest(`${label}: una placa no lleva diámetro`)
        }
      }

      rows.push({
        order_id: id,
        material_type: piece.material_type,
        diameter_mm: piece.diameter_mm ?? null,
        thickness_mm: piece.thickness_mm ?? null,
        width_mm: piece.width_mm ?? null,
        length_mm: piece.length_mm,
        quantity: piece.quantity,
        requested_label:
          typeof piece.requested_label === 'string'
            ? piece.requested_label.trim() || null
            : null,
        source_item_id: piece.source_item_id ?? null,
        sort_order: index,
      })
    }

    // Foto previa para poder restaurar si el insert falla.
    const { data: previous } = await supabase
      .from('cut_plan_pieces')
      .select('*')
      .eq('order_id', id)

    const { error: deleteError } = await supabase
      .from('cut_plan_pieces')
      .delete()
      .eq('order_id', id)
    if (deleteError) {
      console.error('cut-plan delete error:', deleteError)
      return serverError('Error al guardar la lista de corte')
    }

    if (rows.length === 0) return NextResponse.json({ pieces: [] })

    const { data: saved, error: insertError } = await supabase
      .from('cut_plan_pieces')
      .insert(rows)
      .select()

    if (insertError) {
      console.error('cut-plan insert error:', insertError)
      // Restaurar la lista previa: perderla por un error de guardado no es aceptable.
      if (previous && previous.length > 0) {
        const { error: restoreError } = await supabase.from('cut_plan_pieces').insert(
          previous.map(({ id: _id, ...row }) => row),
        )
        if (restoreError) console.error('cut-plan restore error:', restoreError)
      }
      return serverError('Error al guardar la lista de corte')
    }

    return NextResponse.json({ pieces: saved ?? [] })
  } catch (error) {
    console.error('cut-plan PUT error:', error)
    return serverError()
  }
}
