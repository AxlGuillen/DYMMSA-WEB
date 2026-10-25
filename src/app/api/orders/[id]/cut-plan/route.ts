import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError, notFound, serverError } from '@/lib/api-helpers'
import { resolveCutMargin, SETTING_CUT_MARGIN_MM } from '@/lib/cut-plan'
import { saveCutPlan } from '@/lib/cut-plan-store'
import type { CutMaterialType } from '@/types/database'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** Postgres numerics arrive as strings from supabase-js; coerce at the boundary, never in the lib. */
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
      // DYMMSA candidates filtered in JS with the SAME trim+upper as the OrderDetail button.
      supabase
        .from('order_items')
        .select('id, etm, description, quantity_approved, item_type, brand')
        .eq('order_id', id),
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

    // Nominal product measurements only PRE-FILL the candidates.
    const candidateItems = (itemsRes.data ?? []).filter(
      (item) =>
        (!item.item_type || item.item_type === 'product') &&
        (item.brand ?? '').trim().toUpperCase() === 'DYMMSA',
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

/** Replace-all: the body IS the desired state (rules and restore in cut-plan-store). */
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as { pieces?: unknown }
    return NextResponse.json({ pieces: await saveCutPlan(supabase, id, body.pieces) })
  } catch (error) {
    return apiError(error, 'Error interno', 'cut-plan PUT error:')
  }
}

