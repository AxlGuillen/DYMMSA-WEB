import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendApprovalNotification } from '@/lib/email/send-approval-notification'
import { calculateQuotationTotal } from '@/lib/business-rules'

// GET (public) — the quotation behind its approval token.

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

// POST (public) — persists the client's decisions. finalize=false saves progress (rest → null,
// link stays alive); finalize=true sends (rest → false, status → approved/rejected + approved_at).

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

    // Reset approvable products to pending (save) or rejected (finalize);
    // is_sold=false is excluded — it is never approvable.
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

    // Saving progress must not touch the status.
    if (!finalize) {
      return NextResponse.json({ saved: true, finalized: false, approvedCount: approvedIds.length })
    }

    // Optimistic guard: only ONE request can finalize — the second matches 0 rows → 409.
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

    // Notify DYMMSA only on approval; isolated so an email failure never reverts it (ADR-012).
    if (newStatus === 'approved') {
      try {
        // Total of what was ACTUALLY approved: total_amount would over-report a partial approval.
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
            : quotation.total_amount, // fallback if the read fails
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
