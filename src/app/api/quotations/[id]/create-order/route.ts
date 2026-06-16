import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { allocateInventory } from '@/lib/business-rules'
import { explainPgError } from '@/lib/supabase-errors'
import type { QuotationItem, OrderItemInsert } from '@/types/database'

interface StockResult {
  model_code: string
  newQty: number
}

type OrderItemPayload = Omit<OrderItemInsert, 'order_id'>

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error
    const { user } = auth

    console.log(`[create-order] START quotationId=${id} userId=${user.id}`)

    // Fetch quotation with items — must be approved; any authenticated user can create the order
    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('*, quotation_items(*)')
      .eq('id', id)
      .limit(5000, { foreignTable: 'quotation_items' })
      .single()

    if (fetchError || !quotation) {
      console.error(`[create-order] quotation not found id=${id} dbError=${fetchError?.message}`)
      return NextResponse.json({ message: 'Cotización no encontrada' }, { status: 404 })
    }

    if (quotation.status !== 'approved') {
      console.log(`[create-order] rejected: bad status="${quotation.status}" quotationId=${id}`)
      return NextResponse.json(
        { message: 'Solo se puede generar una orden a partir de una cotización aprobada' },
        { status: 400 }
      )
    }

    const allItems = (quotation.quotation_items as QuotationItem[])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)

    const approvedProducts = allItems.filter(
      (i) => (i.item_type === 'product' || !i.item_type) && i.is_approved === true
    )

    const seps = allItems.filter((i) => i.item_type === 'separator').length
    console.log(`[create-order] items total=${allItems.length} separators=${seps} approved=${approvedProducts.length}`)

    if (approvedProducts.length === 0) {
      console.log(`[create-order] rejected: no approved products quotationId=${id}`)
      return NextResponse.json(
        { message: 'No hay productos aprobados en esta cotización' },
        { status: 400 }
      )
    }

    // Build order items: include all separators + approved products (preserving sort order)
    let totalAmount = 0
    let sortIndex = 0
    const inventoryUpdates: StockResult[] = []
    const orderItemsPayload: OrderItemPayload[] = []

    // Approved product IDs for quick lookup
    const approvedIds = new Set(approvedProducts.map((i) => i.id))

    for (const item of allItems) {
      const isSep = item.item_type === 'separator'

      if (isSep) {
        orderItemsPayload.push({
          sort_order:        sortIndex++,
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
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- sequential DB writes (ordering / avoid inventory races)
        const { data: inv } = await supabase
          .from('store_inventory')
          .select('quantity')
          .eq('model_code', item.model_code)
          .single()

        if (inv) {
          const allocation = allocateInventory(quantityApproved, inv.quantity)
          quantityInStock = allocation.inStock
          quantityToOrder = allocation.toOrder

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
        sort_order:        sortIndex++,
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
        status:        'ordered',
        total_amount:  totalAmount,
        created_by:    user.id,
      })
      .select()
      .single()

    if (orderError || !order) {
      console.error(`[create-order] order insert error quotationId=${id}`, orderError)
      return NextResponse.json({ message: 'Error al crear la orden' }, { status: 500 })
    }

    console.log(`[create-order] order inserted orderId=${order.id} total=${totalAmount}`)

    // Insert order items
    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItemsPayload.map((i) => ({ ...i, order_id: order.id })))

    if (itemsError) {
      await supabase.from('orders').delete().eq('id', order.id)
      console.error(`[create-order] items insert error rolling back orderId=${order.id}`, itemsError)
      // El payload de orderItemsPayload tiene etm/quantity_approved/unit_price → scaneable.
      const info = explainPgError(itemsError, orderItemsPayload)
      return NextResponse.json(
        { message: info.userMessage, offendingEtm: info.offendingEtm },
        { status: info.isConstraintViolation ? 400 : 500 }
      )
    }

    // Deduct inventory in parallel (independent writes per model_code)
    await Promise.all(
      inventoryUpdates.map(async (upd) => {
        await supabase
          .from('store_inventory')
          .update({ quantity: upd.newQty })
          .eq('model_code', upd.model_code)
        console.log(`[create-order] inventory deducted model=${upd.model_code} newQty=${upd.newQty}`)
      })
    )

    // Mark quotation as converted
    await supabase
      .from('quotations')
      .update({ status: 'converted_to_order' })
      .eq('id', id)

    console.log(`[create-order] DONE orderId=${order.id} items=${approvedProducts.length} total=${totalAmount}`)

    return NextResponse.json({
      order_id:     order.id,
      items_count:  approvedProducts.length,
      total_amount: totalAmount,
    })
  } catch (error) {
    console.error(`[create-order] unhandled error quotationId=${(await params).id}`, error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
