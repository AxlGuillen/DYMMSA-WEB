import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

// DELETE — Remove a quotation and all its items
// Not allowed if status is 'converted_to_order' (would orphan the order)
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error
    const { user } = auth

    const { data: quotation } = await supabase
      .from('quotations')
      .select('id, status')
      .eq('id', id)
      .single()

    if (!quotation) return NextResponse.json({ message: 'Cotización no encontrada' }, { status: 404 })
    if (quotation.status === 'converted_to_order') {
      return NextResponse.json(
        { message: 'No se puede eliminar una cotización que ya tiene una orden generada' },
        { status: 400 }
      )
    }

    // Delete items first, then quotation
    await supabase.from('quotation_items').delete().eq('quotation_id', id)
    await supabase.from('quotations').delete().eq('id', id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete quotation error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
