import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculateDeliveredTotal, receptionExcess } from '@/lib/business-rules'
import { requireAuth, badRequest, notFound } from '@/lib/api-helpers'
import { explainPgError } from '@/lib/supabase-errors'
import type { ConfirmReceptionInput, ConfirmReceptionResult } from '@/types/database'

/**
 * Confirma la recepción de mercancía de URREA (ADR-019).
 *
 * Inventario: solo el EXCEDENTE (`max(0, recibido − pedido)`) entra a
 * `store_inventory` — lo pedido va al cliente y nunca pisa el stock. El
 * ajuste es por DELTA contra el excedente ya persistido, así que re-confirmar
 * es idempotente y una corrección a la baja resta lo que sobró de más
 * (clamp en 0 con warning si el stock ya se movió).
 */
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
      return badRequest('Items requeridos')
    }
    for (const item of input.items) {
      if (!Number.isInteger(item.quantity_received) || item.quantity_received < 0) {
        return badRequest('La cantidad recibida debe ser un entero mayor o igual a 0')
      }
    }

    // Verify order exists and is in correct status
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', orderId)
      .single()

    if (orderError || !order) return notFound('Orden no encontrada')

    if (order.status === 'completed' || order.status === 'cancelled') {
      return badRequest('No se puede modificar una orden completada o cancelada')
    }

    let inventoryUpdated = 0
    const warnings: string[] = []

    // Sequential: items may share model_code — parallel reads would cause inventory race conditions
    for (const item of input.items) {
      // Leer ANTES de escribir: el excedente previo sale de los valores persistidos.
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- sequential DB writes (ordering / avoid inventory races)
      const { data: currentItem } = await supabase
        .from('order_items')
        .select('model_code, etm, item_type, quantity_received, quantity_to_order')
        .eq('id', item.id)
        .single()

      if (!currentItem) continue
      if (currentItem.item_type === 'separator') continue

      const oldExcess = receptionExcess(currentItem)
      const newExcess = receptionExcess({
        quantity_received: item.quantity_received,
        quantity_to_order: currentItem.quantity_to_order,
      })
      const delta = newExcess - oldExcess
      const tag = currentItem.etm || currentItem.model_code || item.id

      const { error: updateError } = await supabase
        .from('order_items')
        .update({
          quantity_received: item.quantity_received,
          urrea_status: item.urrea_status,
        })
        .eq('id', item.id)

      if (updateError) {
        const explanation = explainPgError(updateError)
        return explanation.isConstraintViolation
          ? badRequest(explanation.userMessage)
          : NextResponse.json({ message: 'Error al actualizar la recepción' }, { status: 500 })
      }

      // Inventario: solo si el excedente cambió y el ítem tiene model_code.
      if (delta !== 0 && currentItem.model_code?.trim()) {
        const { data: inventory } = await supabase
          .from('store_inventory')
          .select('id, quantity')
          .eq('model_code', currentItem.model_code)
          .single()

        if (inventory) {
          const target = inventory.quantity + delta
          if (target < 0) {
            warnings.push(
              `${tag}: la corrección dejaría el stock en negativo; se ajustó a 0 (revisa el inventario de ${currentItem.model_code}).`,
            )
          }
          const { error: invError } = await supabase
            .from('store_inventory')
            .update({ quantity: Math.max(0, target) })
            .eq('id', inventory.id)
          if (invError) {
            const explanation = explainPgError(invError)
            return explanation.isConstraintViolation
              ? badRequest(explanation.userMessage)
              : NextResponse.json({ message: 'Error al ajustar el inventario' }, { status: 500 })
          }
          inventoryUpdated++
        } else if (delta > 0) {
          const { error: invError } = await supabase
            .from('store_inventory')
            .insert({ model_code: currentItem.model_code, quantity: delta })
          if (invError) {
            const explanation = explainPgError(invError)
            return explanation.isConstraintViolation
              ? badRequest(explanation.userMessage)
              : NextResponse.json({ message: 'Error al ajustar el inventario' }, { status: 500 })
          }
          inventoryUpdated++
        } else {
          // delta < 0 sin fila de inventario: no hay de dónde restar.
          warnings.push(
            `${tag}: no existe fila de inventario de ${currentItem.model_code} para restar la corrección del excedente.`,
          )
        }
      }
    }

    // Recalculate total amount based on what will actually be delivered
    // - quantity_in_stock: always counts (already reserved)
    // - min(recibido, pedido): only if not marked as not_supplied (excess is never billed)
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

    const result: ConfirmReceptionResult = {
      success: true,
      inventory_updated: inventoryUpdated,
      warnings,
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('Confirm reception error:', error)
    return NextResponse.json(
      { message: 'Error al confirmar recepción' },
      { status: 500 }
    )
  }
}
