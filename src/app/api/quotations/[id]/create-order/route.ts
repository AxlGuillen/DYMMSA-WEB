import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface StockResult {
  model_code: string
  newQty: number
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ message: 'No autorizado' }, { status: 401 })
    }

    // Fetch quotation with items — must be approved and belong to this user
    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('*, quotation_items(*)')
      .eq('id', id)
      .eq('created_by', user.id)
      .single()

    if (fetchError || !quotation) {
      return NextResponse.json({ message: 'Cotización no encontrada' }, { status: 404 })
    }

    if (quotation.status !== 'approved') {
      return NextResponse.json(
        { message: 'Solo se puede generar una orden a partir de una cotización aprobada' },
        { status: 400 }
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const approvedItems = (quotation.quotation_items as any[]).filter(
      (i) => i.is_approved === true
    )

    if (approvedItems.length === 0) {
      return NextResponse.json(
        { message: 'No hay productos aprobados en esta cotización' },
        { status: 400 }
      )
    }

    // Build order items + resolve inventory
    let totalAmount = 0
    const inventoryUpdates: StockResult[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderItemsPayload: any[] = []

    for (const item of approvedItems) {
      const quantityApproved = item.quantity ?? 1
      const unitPrice = item.unit_price ?? 0

      let quantityInStock = 0
      let quantityToOrder = quantityApproved

      if (item.model_code) {
        const { data: inv } = await supabase
          .from('store_inventory')
          .select('quantity')
          .eq('model_code', item.model_code)
          .single()

        if (inv) {
          quantityInStock = Math.min(quantityApproved, inv.quantity)
          quantityToOrder = quantityApproved - quantityInStock

          if (quantityInStock > 0) {
            inventoryUpdates.push({
              model_code: item.model_code,
              newQty: inv.quantity - quantityInStock,
            })
          }
        }
      }

      totalAmount += unitPrice * quantityApproved

      orderItemsPayload.push({
        etm:               item.etm            || '',
        model_code:        item.model_code     || '',
        description:       item.description    || item.description_es || '',
        brand:             item.brand          || '',
        quantity_approved: quantityApproved,
        quantity_in_stock: quantityInStock,
        quantity_to_order: quantityToOrder,
        quantity_received: 0,
        urrea_status:      'pending',
        unit_price:        unitPrice,
      })
    }

    // Create the order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_name: quotation.customer_name,
        status:        'pending_urrea_order',
        total_amount:  totalAmount,
        created_by:    user.id,
      })
      .select()
      .single()

    if (orderError || !order) {
      console.error('Error creating order:', orderError)
      return NextResponse.json({ message: 'Error al crear la orden' }, { status: 500 })
    }

    // Insert order items
    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItemsPayload.map((i) => ({ ...i, order_id: order.id })))

    if (itemsError) {
      await supabase.from('orders').delete().eq('id', order.id)
      console.error('Error inserting order items:', itemsError)
      return NextResponse.json({ message: 'Error al guardar los productos de la orden' }, { status: 500 })
    }

    // Deduct inventory
    for (const upd of inventoryUpdates) {
      await supabase
        .from('store_inventory')
        .update({ quantity: upd.newQty })
        .eq('model_code', upd.model_code)
    }

    // Mark quotation as converted
    await supabase
      .from('quotations')
      .update({ status: 'converted_to_order' })
      .eq('id', id)

    return NextResponse.json({
      order_id:     order.id,
      items_count:  orderItemsPayload.length,
      total_amount: totalAmount,
    })
  } catch (error) {
    console.error('Create order from quotation error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
