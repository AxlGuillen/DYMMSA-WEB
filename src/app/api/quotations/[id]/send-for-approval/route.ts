import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ message: 'No autorizado' }, { status: 401 })
    }

    // Verify quotation exists, belongs to user and is in draft
    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('id, status, approval_token')
      .eq('id', id)
      .eq('created_by', user.id)
      .single()

    if (fetchError || !quotation) {
      return NextResponse.json({ message: 'Cotización no encontrada' }, { status: 404 })
    }

    if (quotation.status !== 'draft') {
      return NextResponse.json(
        { message: `No se puede enviar a aprobación una cotización en estado "${quotation.status}"` },
        { status: 400 }
      )
    }

    const { data: updated, error: updateError } = await supabase
      .from('quotations')
      .update({ status: 'sent_for_approval' })
      .eq('id', id)
      .select('approval_token')
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ message: 'Error al actualizar estado' }, { status: 500 })
    }

    return NextResponse.json({ approval_token: updated.approval_token })
  } catch (error) {
    console.error('Send for approval error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
