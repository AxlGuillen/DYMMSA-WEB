import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface AddOrderItemInput {
  etm: string
  description: string
  model_code: string
  brand: string
  unit_price: number
  quantity_approved: number
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ message: 'No autorizado' }, { status: 401 })

    const { data: order } = await supabase
      .from('orders')
      .select('id, status, total_amount, created_by')
      .eq('id', id)
      .single()

    if (!order) return NextResponse.json({ message: 'Orden no encontrada' }, { status: 404 })
    if (order.created_by !== user.id) return NextResponse.json({ message: 'No autorizado' }, { status: 401 })
    if (['completed', 'cancelled'].includes(order.status)) {
      return NextResponse.json(
        { message: 'No se puede modificar una orden completada o cancelada' },
        { status: 400 }
      )
    }

    const { etm, description, model_code, brand, unit_price, quantity_approved } =
      (await request.json()) as AddOrderItemInput

    if (!quantity_approved || quantity_approved < 1) {
      return NextResponse.json({ message: 'La cantidad debe ser mayor a 0' }, { status: 400 })
    }
    if (unit_price == null || unit_price < 0) {
      return NextResponse.json({ message: 'El precio no puede ser negativo' }, { status: 400 })
    }

    // Check inventory
    let quantityInStock = 0
    let quantityToOrder = quantity_approved

    if (model_code) {
      const { data: inv } = await supabase
        .from('store_inventory')
        .select('quantity')
        .eq('model_code', model_code)
        .single()

      if (inv) {
        quantityInStock = Math.min(quantity_approved, inv.quantity)
        quantityToOrder = quantity_approved - quantityInStock

        if (quantityInStock > 0) {
          await supabase
            .from('store_inventory')
            .update({ quantity: inv.quantity - quantityInStock })
            .eq('model_code', model_code)
        }
      }
    }

    const { data: newItem, error: insertError } = await supabase
      .from('order_items')
      .insert({
        order_id:          id,
        etm:               etm || '',
        model_code:        model_code || '',
        description:       description || '',
        brand:             brand || '',
        quantity_approved,
        quantity_in_stock: quantityInStock,
        quantity_to_order: quantityToOrder,
        quantity_received: 0,
        urrea_status:      'pending',
        unit_price,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Add order item error:', insertError)
      return NextResponse.json({ message: 'Error al agregar el producto' }, { status: 500 })
    }

    // Recalculate order total
    const { data: allItems } = await supabase
      .from('order_items')
      .select('unit_price, quantity_approved')
      .eq('order_id', id)

    const newTotal = (allItems ?? []).reduce(
      (sum, i) => sum + i.unit_price * i.quantity_approved,
      0
    )
    await supabase.from('orders').update({ total_amount: newTotal }).eq('id', id)

    return NextResponse.json({ item: newItem, total_amount: newTotal })
  } catch (error) {
    console.error('Add order item error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
