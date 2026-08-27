import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, notFound, serverError } from '@/lib/api-helpers'
import { isNotSold } from '@/lib/business-rules'
import type { CutMaterialType } from '@/types/database'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** numeric de supabase-js llega como string → se coerce en la frontera. */
function num(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Piezas DYMMSA de la cotización para sembrar el corte rápido (#71) — misma
 * forma que los candidatos de orden; separadores e is_sold=false fuera.
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data: quotation, error: quotationError } = await supabase
      .from('quotations')
      .select('id, quotation_number, customer_name')
      .eq('id', id)
      .single()
    // PGRST116 = cero filas (el 404 legítimo); cualquier otro error es de
    // infraestructura y no debe disfrazarse de "no existe" (review PR #76).
    if (quotationError && quotationError.code !== 'PGRST116') {
      console.error('cut-candidates quotation error:', quotationError)
      return serverError('Error al cargar la cotización')
    }
    if (!quotation) return notFound('Cotización no encontrada')

    const { data: items, error } = await supabase
      .from('quotation_items')
      .select('id, etm, description, quantity, item_type, brand, is_sold')
      .eq('quotation_id', id)
      .order('sort_order', { ascending: true })
    if (error) {
      console.error('cut-candidates items error:', error)
      return serverError('Error al cargar los ítems de la cotización')
    }

    const candidateItems = (items ?? []).filter(
      (item) =>
        (!item.item_type || item.item_type === 'product') &&
        !isNotSold(item) &&
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
      quotation: {
        id: quotation.id,
        quotation_number: quotation.quotation_number,
        customer_name: quotation.customer_name,
      },
      candidates: candidateItems.map((item) => {
        const nominal = item.etm ? nominalByEtm.get(item.etm) : undefined
        return {
          itemId: item.id,
          etm: item.etm,
          description: item.description,
          quantity: item.quantity ?? 1,
          cutKind: (nominal?.cut_kind ?? null) as CutMaterialType | null,
          diameterMm: num(nominal?.cut_diameter_mm),
          thicknessMm: num(nominal?.cut_thickness_mm),
          widthMm: num(nominal?.cut_width_mm),
          lengthMm: num(nominal?.cut_length_mm),
        }
      }),
    })
  } catch (error) {
    console.error('cut-candidates GET error:', error)
    return serverError()
  }
}
