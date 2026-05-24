import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { restoreOrderInventory } from '@/lib/inventory'

type Params = { params: Promise<{ id: string }> }

// DELETE — Remove an order and all its items (any status allowed).
// Restores inventory for items that had quantity_in_stock > 0, same as cancel.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id: orderId } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq('id', orderId)
      .single()

    if (!order) return NextResponse.json({ message: 'Orden no encontrada' }, { status: 404 })

    // Restore inventory before deleting (same logic as cancel)
    await restoreOrderInventory(supabase, orderId)

    // Delete items first (FK), then order
    await supabase.from('order_items').delete().eq('order_id', orderId)
    await supabase.from('orders').delete().eq('id', orderId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete order error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
