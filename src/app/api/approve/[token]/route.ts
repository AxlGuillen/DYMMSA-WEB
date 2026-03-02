import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
// Public: submit item-level decisions and update quotation status   //
// ------------------------------------------------------------------ //

interface Decision {
  item_id: string
  is_approved: boolean
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const supabase = createAdminClient()

    // Verify quotation exists and is still awaiting approval
    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('id, status')
      .eq('approval_token', token)
      .single()

    if (fetchError || !quotation) {
      return NextResponse.json({ message: 'Cotización no encontrada' }, { status: 404 })
    }

    if (quotation.status !== 'sent_for_approval') {
      return NextResponse.json(
        { message: 'Esta cotización ya fue procesada' },
        { status: 400 }
      )
    }

    const body = (await request.json()) as { decisions: Decision[] }
    const { decisions } = body

    if (!decisions?.length) {
      return NextResponse.json({ message: 'No se enviaron decisiones' }, { status: 400 })
    }

    // Update each quotation item
    for (const decision of decisions) {
      const { error } = await supabase
        .from('quotation_items')
        .update({ is_approved: decision.is_approved })
        .eq('id', decision.item_id)
        .eq('quotation_id', quotation.id)

      if (error) {
        console.error('Error updating item:', decision.item_id, error)
      }
    }

    // Determine new quotation status
    const hasApproved = decisions.some((d) => d.is_approved)
    const newStatus = hasApproved ? 'approved' : 'rejected'

    await supabase
      .from('quotations')
      .update({ status: newStatus })
      .eq('id', quotation.id)

    return NextResponse.json({ status: newStatus })
  } catch (error) {
    console.error('Approve POST error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
