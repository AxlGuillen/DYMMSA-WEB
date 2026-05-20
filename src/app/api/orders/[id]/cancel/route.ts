import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { restoreOrderInventory } from '@/lib/inventory'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await context.params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    // Get order with items
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json(
        { message: 'Orden no encontrada' },
        { status: 404 }
      )
    }

    if (order.status === 'cancelled') {
      return NextResponse.json(
        { message: 'Orden ya está cancelada' },
        { status: 400 }
      )
    }

    if (order.status === 'completed') {
      return NextResponse.json(
        { message: 'No se puede cancelar una orden completada' },
        { status: 400 }
      )
    }

    // Restore inventory using shared helper (computeRestoration + DB writes)
    const { restored: inventoryRestored } = await restoreOrderInventory(supabase, orderId)

    // Update order status to cancelled
    await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId)

    return NextResponse.json({
      success: true,
      inventory_restored: inventoryRestored,
    })
  } catch (error) {
    console.error('Cancel order error:', error)
    return NextResponse.json(
      { message: 'Error al cancelar orden' },
      { status: 500 }
    )
  }
}
