import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { allocateInventory } from '@/lib/business-rules'
import { requireAuth } from '@/lib/api-helpers'
import type { CreateOrderInput, OrderItemInsert } from '@/types/database'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error
    const { user } = auth

    const input = (await request.json()) as CreateOrderInput

    if (!input.customer_name || !input.products || !input.products.length) {
      return NextResponse.json(
        { message: 'Nombre de cliente y productos son requeridos' },
        { status: 400 }
      )
    }

    // Fetch all inventory records in parallel, then build order items
    const productAllocations = await Promise.all(
      input.products.map(async (product, sortIndex) => {
        const { data: inventory } = await supabase
          .from('store_inventory')
          .select('id, quantity')
          .eq('model_code', product.model_code)
          .single()

        const availableStock = inventory?.quantity || 0
        const quantityApproved = product.quantity || 1
        const { inStock: quantityInStock, toOrder: quantityToOrder } =
          allocateInventory(quantityApproved, availableStock)

        return { product, sortIndex, inventory, quantityInStock, quantityToOrder, quantityApproved }
      })
    )

    const orderItems: OrderItemInsert[] = []
    let totalAmount = 0
    const inventoryUpdates: { model_code: string; quantity: number }[] = []

    for (const { product, sortIndex, inventory, quantityInStock, quantityToOrder, quantityApproved } of productAllocations) {
      if (quantityInStock > 0 && inventory) {
        inventoryUpdates.push({
          model_code: product.model_code,
          quantity: inventory.quantity - quantityInStock,
        })
      }

      totalAmount += quantityApproved * product.price

      orderItems.push({
        order_id: '', // Will be set after order creation
        item_type: 'product',
        section_label: null,
        etm: product.etm,
        model_code: product.model_code,
        description: product.description || product.description_es || '',
        brand: product.brand || '',
        quantity_approved: quantityApproved,
        quantity_in_stock: quantityInStock,
        quantity_to_order: quantityToOrder,
        quantity_received: 0,
        urrea_status: 'pending',
        delivery_time: 'immediate',
        unit_price: product.price,
        sort_order: sortIndex,
      })
    }

    // Create order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_name: input.customer_name,
        status: 'ordered',
        total_amount: totalAmount,
        created_by: user.id,
      })
      .select()
      .single()

    if (orderError) {
      console.error('Error creating order:', orderError)
      return NextResponse.json(
        { message: 'Error al crear orden' },
        { status: 500 }
      )
    }

    // Create order items
    const itemsWithOrderId = orderItems.map((item) => ({
      ...item,
      order_id: order.id,
    }))

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(itemsWithOrderId)

    if (itemsError) {
      console.error('Error creating order items:', itemsError)
      // Rollback: delete the order
      await supabase.from('orders').delete().eq('id', order.id)
      return NextResponse.json(
        { message: 'Error al crear items de orden' },
        { status: 500 }
      )
    }

    // Update inventory in parallel (independent writes per model_code)
    await Promise.all(
      inventoryUpdates.map((update) =>
        supabase
          .from('store_inventory')
          .update({ quantity: update.quantity })
          .eq('model_code', update.model_code)
      )
    )

    // Get items that need to be ordered from URREA
    const itemsToOrder = orderItems.filter((item) => item.quantity_to_order > 0)

    return NextResponse.json({
      order_id: order.id,
      customer_name: order.customer_name,
      total_amount: totalAmount,
      items_count: orderItems.length,
      items_to_order: itemsToOrder.length,
      inventory_updated: inventoryUpdates.length,
    })
  } catch (error) {
    console.error('Create order error:', error)
    return NextResponse.json(
      { message: 'Error al crear orden' },
      { status: 500 }
    )
  }
}
