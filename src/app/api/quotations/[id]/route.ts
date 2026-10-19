import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, notFound, badRequest, serverError } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

const LINKED_ORDER_MESSAGE = 'Elimina la orden vinculada antes de eliminar esta cotización.'

// GET — single quotation with its items, ordered by sort_order.
// limit(5000) on the embed avoids PostgREST's default 1000-row truncation.
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

// DELETE — removes the quotation; its items go with it (ON DELETE CASCADE).
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

    if (!quotation) return notFound('Cotización no encontrada')

    // Same rule as reopening (ADR-010): deleting the order first is what restores its stock.
    const { data: linkedOrders, error: ordersError } = await supabase
      .from('orders')
      .select('id')
      .eq('quotation_id', id)
      .limit(1)

    if (ordersError) {
      console.error('Delete quotation: linked order lookup error:', ordersError)
      return serverError('Error al eliminar la cotización')
    }
    if (linkedOrders && linkedOrders.length > 0) return badRequest(LINKED_ORDER_MESSAGE)

    const { error: deleteError } = await supabase.from('quotations').delete().eq('id', id)

    if (deleteError) {
      console.error('Delete quotation error:', deleteError)
      // 23503: an order got linked after the check; orders.quotation_id is the only FK without cascade.
      if (deleteError.code === '23503') return badRequest(LINKED_ORDER_MESSAGE)
      return serverError('Error al eliminar la cotización')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete quotation error:', error)
    return serverError()
  }
}
