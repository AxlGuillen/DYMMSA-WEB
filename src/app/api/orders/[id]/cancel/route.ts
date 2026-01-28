import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await context.params
    const supabase = await createClient()

    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ message: 'No autorizado' }, { status: 401 })
    }

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

    // Get order items
    const { data: items } = await supabase
      .from('order_items')
      .select('model_code, quantity_in_stock, quantity_received')
      .eq('order_id', orderId)

    let inventoryRestored = 0

    // Restore inventory for each item
    if (items) {
      for (const item of items) {
        // Calculate total to restore (what was taken from stock + what was received)
        const toRestore = item.quantity_in_stock + item.quantity_received

        if (toRestore > 0) {
          // Get current inventory
          const { data: inventory } = await supabase
            .from('store_inventory')
            .select('id, quantity')
            .eq('model_code', item.model_code)
            .single()

          if (inventory) {
            // Update existing
            await supabase
              .from('store_inventory')
              .update({ quantity: inventory.quantity + toRestore })
              .eq('id', inventory.id)
          } else {
            // Create new inventory entry
            await supabase
              .from('store_inventory')
              .insert({
                model_code: item.model_code,
                quantity: toRestore,
              })
          }
          inventoryRestored++
        }
      }
    }

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
