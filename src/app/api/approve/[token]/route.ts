import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendApprovalNotification } from '@/lib/email/send-approval-notification'
import { calculateQuotationTotal } from '@/lib/business-rules'

// ------------------------------------------------------------------ //
// GET /api/approve/[token]                                           //
// Public: fetch quotation by approval token                         //
// ------------------------------------------------------------------ //

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('quotations')
      .select('id, customer_name, status, total_amount, created_at, quotation_items(*)')
      .eq('approval_token', token)
      .limit(5000, { foreignTable: 'quotation_items' })
      .single()

    if (error || !data) {
      return NextResponse.json({ message: 'Cotización no encontrada' }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Approve GET error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}

// ------------------------------------------------------------------ //
// POST /api/approve/[token]                                          //
// Público. Persiste las decisiones del cliente.                      //
//   - finalize=false → "guardar avance": aprobados=true, el resto=null
//     (pendiente), y el status NO cambia (el link sigue vivo).       //
//   - finalize=true  → "enviar aprobación": el resto=false (rechazo),
//     status→approved/rejected + approved_at.                        //
// Eficiente: 2-3 queries fijas (no una por ítem).                    //
// ------------------------------------------------------------------ //

interface ApprovePayload {
  approvedIds?: string[]
  finalize?: boolean
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const supabase = createAdminClient()

    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('id, status, name, customer_name, total_amount')
      .eq('approval_token', token)
      .single()

    if (fetchError || !quotation) {
      return NextResponse.json({ message: 'Cotización no encontrada' }, { status: 404 })
    }

    if (quotation.status !== 'sent_for_approval') {
      return NextResponse.json({ message: 'Esta cotización ya fue procesada' }, { status: 400 })
    }

    const { approvedIds = [], finalize = false } = (await request.json()) as ApprovePayload
    if (!Array.isArray(approvedIds)) {
      return NextResponse.json({ message: 'Payload inválido' }, { status: 400 })
    }

    // 1. Reset de productos aprobables: pendiente (guardar) o rechazado (finalizar).
    //    Excluye los "No disponible" (is_sold=false) para no marcarlos.
    const resetValue = finalize ? false : null
    const { error: resetError } = await supabase
      .from('quotation_items')
      .update({ is_approved: resetValue })
      .eq('quotation_id', quotation.id)
      .eq('item_type', 'product')
      .or('is_sold.is.null,is_sold.eq.true')

    if (resetError) {
      console.error('Error resetting approvals:', resetError)
      return NextResponse.json({ message: 'Error al guardar las decisiones' }, { status: 500 })
    }

    // 2. Aprobar los seleccionados.
    if (approvedIds.length > 0) {
      const { error: approveError } = await supabase
        .from('quotation_items')
        .update({ is_approved: true })
        .eq('quotation_id', quotation.id)
        .in('id', approvedIds)

      if (approveError) {
        console.error('Error approving items:', approveError)
        return NextResponse.json({ message: 'Error al guardar las decisiones' }, { status: 500 })
      }
    }

    // 3. Guardar avance → no toca el status.
    if (!finalize) {
      return NextResponse.json({ saved: true, finalized: false, approvedCount: approvedIds.length })
    }

    // 4. Finalizar → status + approved_at, con guarda de concurrencia optimista.
    //    El `.eq('status', 'sent_for_approval')` garantiza que sólo UN request
    //    finalice: si otro (misma liga abierta en dos pestañas/dispositivos) ya
    //    transicionó entre el fetch inicial y aquí, este update matchea 0 filas y
    //    devolvemos 409 en vez de sellar un estado inconsistente.
    const newStatus = approvedIds.length > 0 ? 'approved' : 'rejected'
    const { data: finalized, error: statusError } = await supabase
      .from('quotations')
      .update({
        status: newStatus,
        approved_at: newStatus === 'approved' ? new Date().toISOString() : null,
      })
      .eq('id', quotation.id)
      .eq('status', 'sent_for_approval')
      .select('id')

    if (statusError) {
      console.error('Error finalizing approval:', statusError)
      return NextResponse.json({ message: 'Error al guardar las decisiones' }, { status: 500 })
    }

    if (!finalized || finalized.length === 0) {
      return NextResponse.json({ message: 'Esta cotización ya fue procesada' }, { status: 409 })
    }

    // 5. Notificar a DYMMSA sólo cuando el cliente aprueba (status approved).
    //    Aislado: un fallo de correo nunca revierte la aprobación (ADR-012).
    if (newStatus === 'approved') {
      try {
        // Total de lo REALMENTE aprobado: en una aprobación parcial,
        // quotation.total_amount (toda la cotización) reportaría de más.
        // calculateQuotationTotal ya excluye separadores e is_sold=false.
        const { data: approvedItems, error: approvedItemsError } = await supabase
          .from('quotation_items')
          .select('unit_price, quantity, item_type, is_approved, is_sold')
          .eq('quotation_id', quotation.id)
          .eq('is_approved', true)
          .limit(5000)

        const hasApprovedItems = !approvedItemsError && approvedItems !== null
        await sendApprovalNotification({
          customerName: quotation.customer_name,
          quotationName: quotation.name,
          total: hasApprovedItems
            ? calculateQuotationTotal(approvedItems, { onlyApproved: true })
            : quotation.total_amount, // fallback si la lectura falla
          approvedCount: hasApprovedItems ? approvedItems.length : approvedIds.length,
          quotationId: quotation.id,
        })
      } catch (notifyError) {
        console.warn('Approval notification failed (ignored):', notifyError)
      }
    }

    return NextResponse.json({ saved: true, finalized: true, status: newStatus })
  } catch (error) {
    console.error('Approve POST error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
