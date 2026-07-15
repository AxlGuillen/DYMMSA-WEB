import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, notFound, serverError } from '@/lib/api-helpers'
import { fetchCatalogEntryMap } from '@/lib/urrea-catalog'
import {
  buildPurchasePlan,
  resolveThresholds,
  SETTING_THRESHOLD_MONEY,
  SETTING_THRESHOLD_PCT,
} from '@/lib/purchase-plan'

/**
 * GET /api/orders/[id]/purchase-plan — plan de compra mayoreo/menudeo (ADR-018).
 *
 * El plan se calcula SIEMPRE al vuelo con las cantidades actuales de la orden;
 * las decisiones guardadas se casan por grupo y traen su flag de staleness.
 * Catálogo y settings degradan a defaults (el plan nunca truena por ellos);
 * solo el fetch de la orden/ítems es fatal.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data: order } = await supabase
      .from('orders')
      .select('id, name, status, customer_name')
      .eq('id', id)
      .single()

    if (!order) return notFound('Orden no encontrada')

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('id, item_type, etm, model_code, brand, section_label, quantity_to_order, unit_price')
      .eq('order_id', id)
      .limit(5000)

    if (itemsError || !items) {
      console.error('purchase-plan items error:', itemsError)
      return serverError('Error al cargar los productos de la orden')
    }

    const catalog = await fetchCatalogEntryMap(supabase, items.map((i) => i.model_code))

    const { data: decisions, error: decisionsError } = await supabase
      .from('order_purchase_decisions')
      .select('*')
      .eq('order_id', id)

    if (decisionsError) {
      console.error('purchase-plan decisions error:', decisionsError)
      return serverError('Error al cargar las decisiones de compra')
    }

    const { data: settingRows } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', [SETTING_THRESHOLD_MONEY, SETTING_THRESHOLD_PCT])

    const thresholds = resolveThresholds(
      Object.fromEntries((settingRows ?? []).map((row) => [row.key, row.value])),
    )

    const plan = buildPurchasePlan(items, catalog, decisions ?? [], thresholds)

    return NextResponse.json({ order, plan })
  } catch (error) {
    console.error('purchase-plan error:', error)
    return serverError()
  }
}
