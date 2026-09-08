/** Inventory: pure math kept apart from the DB operations (testable without a mock). */

import { receivedForCustomer } from '@/lib/business-rules'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

type RestorableItem = {
  model_code: string | null
  quantity_in_stock: number
  quantity_received: number
  quantity_to_order: number
}

/** Restore on cancel/delete: stock taken + min(received, ordered). The excess is NOT restored —
 *  it already entered on reception and adding it back would duplicate it (ADR-019). */
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

/** Applies computeRestoration with upserts: adds to the row if it exists, creates it otherwise. */
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
