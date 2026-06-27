import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, notFound, serverError } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

// GET — Single quotation with all its items (ordered by sort_order).
// limit(5000) on the embed avoids the PostgREST default 1000-row truncation
// for large quotations; sort_order keeps the editor's item order stable.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase
      .from('quotations')
      .select('*, quotation_items(*)')
      .eq('id', id)
      .order('sort_order', { foreignTable: 'quotation_items', ascending: true })
      .limit(5000, { foreignTable: 'quotation_items' })
      .single()

    if (error) {
      if (error.code === 'PGRST116') return notFound('Cotización no encontrada')
      console.error('Get quotation error:', error)
      return serverError('Error al obtener la cotización')
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Get quotation error:', error)
    return serverError('Error al obtener la cotización')
  }
}

// DELETE — Remove a quotation and all its items (any status allowed)
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data: quotation } = await supabase
      .from('quotations')
      .select('id')
      .eq('id', id)
      .single()

    if (!quotation) return NextResponse.json({ message: 'Cotización no encontrada' }, { status: 404 })

    // Delete items first (FK), then quotation
    await supabase.from('quotation_items').delete().eq('quotation_id', id)
    await supabase.from('quotations').delete().eq('id', id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete quotation error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
