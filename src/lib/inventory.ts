/** Inventario: cálculos puros separados de las operaciones de DB (testeables sin mock). */

import { receivedForCustomer } from '@/lib/business-rules'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

// ─── Cálculos puros ────────────────────────────────────────────────────

type RestorableItem = {
  model_code: string | null
  quantity_in_stock: number
  quantity_received: number
  quantity_to_order: number
}

/**
 * Restauración al cancelar/eliminar orden: stock tomado + min(recibido, pedido).
 * El excedente NO se restaura — ya entró en la recepción; sumarlo lo duplicaría (ADR-019).
 */
export function computeRestoration<T extends RestorableItem>(
  items: T[]
): Array<{ model_code: string; quantityToRestore: number }> {
  return items
    .map((item) => ({
      model_code: item.model_code,
      quantityToRestore: item.quantity_in_stock + receivedForCustomer(item),
    }))
    .filter(
      (r): r is { model_code: string; quantityToRestore: number } =>
        r.model_code != null && r.model_code.trim() !== '' && r.quantityToRestore > 0
    )
}

// ─── Operaciones de DB ─────────────────────────────────────────────────

/** Aplica computeRestoration con upserts (suma si existe, crea si no); retorna filas restauradas. */
export async function restoreOrderInventory(
  supabase: SupabaseServerClient,
  orderId: string
): Promise<{ restored: number }> {
  const { data: items } = await supabase
    .from('order_items')
    .select('model_code, quantity_in_stock, quantity_received, quantity_to_order')
    .eq('order_id', orderId)

  if (!items) return { restored: 0 }

  const restorations = computeRestoration(items)
  let restored = 0

  for (const { model_code, quantityToRestore } of restorations) {
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- sequential DB writes (ordering / avoid inventory races)
    const { data: inventory } = await supabase
      .from('store_inventory')
      .select('id, quantity')
      .eq('model_code', model_code)
      .single()

    if (inventory) {
      await supabase
        .from('store_inventory')
        .update({ quantity: inventory.quantity + quantityToRestore })
        .eq('id', inventory.id)
    } else {
      await supabase
        .from('store_inventory')
        .insert({ model_code, quantity: quantityToRestore })
    }
    restored++
  }

  return { restored }
}
