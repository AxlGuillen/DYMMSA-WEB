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
    const allItems = (quotation.quotation_items as any[])
      .slice()
      .sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const approvedProducts = allItems.filter((i: any) =>
      (i.item_type === 'product' || !i.item_type) && i.is_approved === true
    )

    if (approvedProducts.length === 0) {
      return NextResponse.json(
        { message: 'No hay productos aprobados en esta cotización' },
        { status: 400 }
      )
    }

    // Build order items: include all separators + approved products (preserving sort order)
    let totalAmount = 0
    const inventoryUpdates: StockResult[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderItemsPayload: any[] = []

    // Approved product IDs for quick lookup
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const approvedIds = new Set(approvedProducts.map((i: any) => i.id))

    for (const item of allItems) {
      const isSep = item.item_type === 'separator'

      if (isSep) {
        orderItemsPayload.push({
          item_type:         'separator',
          section_label:     item.section_label ?? null,
          etm:               '',
          model_code:        '',
          description:       '',
          brand:             '',
          quantity_approved: 0,
          quantity_in_stock: 0,
          quantity_to_order: 0,
          quantity_received: 0,
          urrea_status:      'pending',
          delivery_time:     'immediate',
          unit_price:        0,
        })
        continue
      }

      if (!approvedIds.has(item.id)) continue

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
        item_type:         'product',
        section_label:     null,
        etm:               item.etm            || '',
        model_code:        item.model_code     || '',
        description:       item.description    || item.description_es || '',
        brand:             item.brand          || '',
        quantity_approved: quantityApproved,
        quantity_in_stock: quantityInStock,
        quantity_to_order: quantityToOrder,
        quantity_received: 0,
        urrea_status:      'pending',
        delivery_time:     item.delivery_time  || 'immediate',
        unit_price:        unitPrice,
      })
    }

    // Create the order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        name:          quotation.name,
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
      items_count:  approvedProducts.length,
      total_amount: totalAmount,
    })
  } catch (error) {
    console.error('Create order from quotation error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
