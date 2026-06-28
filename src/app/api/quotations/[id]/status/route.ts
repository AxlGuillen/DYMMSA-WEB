import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, notFound, badRequest, serverError } from '@/lib/api-helpers'
import { MANUAL_QUOTATION_STATUSES } from '@/lib/quotation-status'
import type { QuotationStatus } from '@/types/database'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { status } = (await request.json()) as { status: QuotationStatus }

    // converted_to_order no es un destino manual: solo se asigna al generar la orden.
    if (!MANUAL_QUOTATION_STATUSES.includes(status)) {
      return badRequest('El estado "Convertida a orden" solo se asigna al generar la orden')
    }

    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('id, status')
      .eq('id', id)
      .single()

    if (fetchError || !quotation) {
      return notFound('Cotización no encontrada')
    }

    // Guarda: para reabrir una cotización convertida, su orden vinculada debe estar
    // ELIMINADA (eliminar la orden restaura el inventario). Esto además garantiza que
    // una cotización tenga a lo sumo una orden a la vez (evita órdenes huérfanas).
    if (quotation.status === 'converted_to_order') {
      const { data: linkedOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('quotation_id', id)
        .limit(1)

      if (linkedOrders && linkedOrders.length > 0) {
        return badRequest(
          'Elimina la orden vinculada antes de reabrir esta cotización.'
        )
      }
    }

    // Regenerar approval_token en cada cambio manual de estado: invalida cualquier
    // link de aprobación compartido previamente (p. ej. al reabrir una cotización ya
    // enviada/aprobada, el link viejo deja de funcionar).
    // No se tocan los quotation_items → is_approved se preserva.
    const { data: updated, error: updateError } = await supabase
      .from('quotations')
      .update({ status, approval_token: crypto.randomUUID() })
      .eq('id', id)
      .select()
      .single()

    if (updateError || !updated) {
      console.error('Update quotation status error:', updateError)
      return serverError('Error al actualizar el estado')
    }

    return NextResponse.json(updated)
  } catch (error) {
    console.error('PATCH quotation status error:', error)
    return serverError()
  }
}
