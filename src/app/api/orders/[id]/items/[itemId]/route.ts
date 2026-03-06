import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string; itemId: string }> }

async function getOrderAndItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  orderId: string,
  itemId: string
) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, total_amount, created_by')
    .eq('id', orderId)
    .single()

  if (!order) return { error: 'Orden no encontrada', status: 404 }
  if (order.created_by !== userId) return { error: 'No autorizado', status: 401 }
  if (['completed', 'cancelled'].includes(order.status)) {
    return { error: 'No se puede modificar una orden completada o cancelada', status: 400 }
  }

  const { data: item } = await supabase
    .from('order_items')
    .select('*')
    .eq('id', itemId)
    .eq('order_id', orderId)
    .single()

  if (!item) return { error: 'Producto no encontrado', status: 404 }

  return { order, item }
}

async function recalculateTotal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string
) {
  const { data: allItems } = await supabase
    .from('order_items')
    .select('unit_price, quantity_approved')
    .eq('order_id', orderId)

  const newTotal = (allItems ?? []).reduce(
    (sum, i) => sum + i.unit_price * i.quantity_approved,
    0
  )
  await supabase.from('orders').update({ total_amount: newTotal }).eq('id', orderId)
  return newTotal
}

const VALID_DELIVERY_TIMES = ['immediate', '2_3_days', '3_5_days', '1_week', '2_weeks', 'indefinite']

// PATCH — Edit unit_price or delivery_time of an order item
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id, itemId } = await params
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ message: 'No autorizado' }, { status: 401 })

    const result = await getOrderAndItem(supabase, user.id, id, itemId)
    if ('error' in result) {
      return NextResponse.json({ message: result.error }, { status: result.status })
    }

    const body = await request.json()
    const updates: Record<string, unknown> = {}

    if (body.unit_price != null) {
      if (body.unit_price < 0) {
        return NextResponse.json({ message: 'Precio inválido' }, { status: 400 })
      }
      updates.unit_price = body.unit_price
    }

    if (body.delivery_time != null) {
      if (!VALID_DELIVERY_TIMES.includes(body.delivery_time)) {
        return NextResponse.json({ message: 'Tiempo de entrega inválido' }, { status: 400 })
      }
      updates.delivery_time = body.delivery_time
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ message: 'Sin cambios' }, { status: 400 })
    }

    await supabase.from('order_items').update(updates).eq('id', itemId)

    if (updates.unit_price != null) {
      const newTotal = await recalculateTotal(supabase, id)
      return NextResponse.json({ total_amount: newTotal })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Edit order item error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}

// DELETE — Remove item and restore its inventory
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id, itemId } = await params
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ message: 'No autorizado' }, { status: 401 })

    const result = await getOrderAndItem(supabase, user.id, id, itemId)
    if ('error' in result) {
      return NextResponse.json({ message: result.error }, { status: result.status })
    }

    const { item } = result

    // Restore inventory for the quantity_in_stock portion
    if (item.model_code && item.quantity_in_stock > 0) {
      const { data: inv } = await supabase
        .from('store_inventory')
        .select('quantity')
        .eq('model_code', item.model_code)
        .single()

      if (inv) {
        await supabase
          .from('store_inventory')
          .update({ quantity: inv.quantity + item.quantity_in_stock })
          .eq('model_code', item.model_code)
      }
    }

    await supabase.from('order_items').delete().eq('id', itemId)

    const newTotal = await recalculateTotal(supabase, id)
    return NextResponse.json({ total_amount: newTotal })
  } catch (error) {
    console.error('Delete order item error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
