import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculateDeliveredTotal } from '@/lib/business-rules'
import { requireAuth } from '@/lib/api-helpers'
import type { ConfirmReceptionInput } from '@/types/database'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await context.params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

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

    // Sequential: items may share model_code — parallel reads would cause inventory race conditions
    for (const item of input.items) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- sequential DB writes (ordering / avoid inventory races)
      const { data: currentItem } = await supabase
        .from('order_items')
        .select('model_code')
        .eq('id', item.id)
        .single()

      if (!currentItem) continue

      await supabase
        .from('order_items')
        .update({
          quantity_received: item.quantity_received,
          urrea_status: item.urrea_status,
        })
        .eq('id', item.id)

      if (item.quantity_received > 0) {
        const { data: inventory } = await supabase
          .from('store_inventory')
          .select('id, quantity')
          .eq('model_code', currentItem.model_code)
          .single()

        if (inventory) {
          await supabase
            .from('store_inventory')
            .update({ quantity: inventory.quantity + item.quantity_received })
            .eq('id', inventory.id)
        } else {
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
      .select('quantity_in_stock, quantity_received, quantity_to_order, urrea_status, unit_price, item_type')
      .eq('order_id', orderId)
      .limit(5000)

    if (allItems) {
      const newTotal = calculateDeliveredTotal(allItems)

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
