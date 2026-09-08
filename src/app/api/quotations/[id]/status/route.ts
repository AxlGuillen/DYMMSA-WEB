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

    // converted_to_order is not a manual target: it is only set when the order is generated.
    if (!MANUAL_QUOTATION_STATUSES.includes(status)) {
      return badRequest('El estado "Convertida a orden" solo se asigna al generar la orden')
    }

    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('id, status, approved_at')
      .eq('id', id)
      .single()

    if (fetchError || !quotation) {
      return notFound('Cotización no encontrada')
    }

    // Reopening a converted quotation requires its linked order to be deleted (that restores
    // inventory) and keeps at most one order per quotation.
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

    // Every status change regenerates approval_token, killing the old link; is_approved and
    // approved_at are preserved — approved_at is only sealed when still empty.
    const updatePayload: {
      status: QuotationStatus
      approval_token: string
      approved_at?: string
    } = {
      status,
      approval_token: crypto.randomUUID(),
    }
    if (status === 'approved' && !quotation.approved_at) {
      updatePayload.approved_at = new Date().toISOString()
    }

    const { data: updated, error: updateError } = await supabase
      .from('quotations')
      .update(updatePayload)
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
