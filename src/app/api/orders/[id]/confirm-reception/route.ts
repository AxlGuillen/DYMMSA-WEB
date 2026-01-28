import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ConfirmReceptionInput } from '@/types/database'

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

    const input = (await request.json()) as ConfirmReceptionInput

    if (!input.items || !input.items.length) {
      return NextResponse.json(
        { message: 'Items requeridos' },
        { status: 400 }
      )
    }

    // Verify order exists and is in correct status
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

    if (order.status === 'completed' || order.status === 'cancelled') {
      return NextResponse.json(
        { message: 'No se puede modificar una orden completada o cancelada' },
        { status: 400 }
      )
    }

    let inventoryUpdated = 0

    // Update each item
    for (const item of input.items) {
      // Get current item to find model_code
      const { data: currentItem } = await supabase
        .from('order_items')
        .select('model_code')
        .eq('id', item.id)
        .single()

      if (!currentItem) continue

      // Update order item
      await supabase
        .from('order_items')
        .update({
          quantity_received: item.quantity_received,
          urrea_status: item.urrea_status,
        })
        .eq('id', item.id)

      // If received quantity > 0, add to inventory
      if (item.quantity_received > 0) {
        // Check if item exists in inventory
        const { data: inventory } = await supabase
          .from('store_inventory')
          .select('id, quantity')
          .eq('model_code', currentItem.model_code)
          .single()

        if (inventory) {
          // Update existing
          await supabase
            .from('store_inventory')
            .update({ quantity: inventory.quantity + item.quantity_received })
            .eq('id', inventory.id)
        } else {
          // Create new inventory entry
          await supabase
            .from('store_inventory')
            .insert({
              model_code: currentItem.model_code,
              quantity: item.quantity_received,
            })
        }
        inventoryUpdated++
      }
    }

    // Recalculate total amount based on what will actually be delivered
    // - quantity_in_stock: always counts (already reserved)
    // - quantity_received: only if not marked as not_supplied
    const { data: allItems } = await supabase
      .from('order_items')
      .select('quantity_in_stock, quantity_received, urrea_status, unit_price')
      .eq('order_id', orderId)

    if (allItems) {
      const newTotal = allItems.reduce((sum, item) => {
        let quantityDelivered = item.quantity_in_stock
        if (item.urrea_status !== 'not_supplied') {
          quantityDelivered += item.quantity_received
        }
        return sum + quantityDelivered * item.unit_price
      }, 0)

      await supabase
        .from('orders')
        .update({ total_amount: newTotal })
        .eq('id', orderId)
    }

    return NextResponse.json({
      success: true,
      inventory_updated: inventoryUpdated,
    })
  } catch (error) {
    console.error('Confirm reception error:', error)
    return NextResponse.json(
      { message: 'Error al confirmar recepción' },
      { status: 500 }
    )
  }
}
