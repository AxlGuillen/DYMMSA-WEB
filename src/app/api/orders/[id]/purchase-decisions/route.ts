import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, notFound, badRequest, serverError } from '@/lib/api-helpers'
import { normalizeCatalogBrand, normalizeCatalogCode } from '@/lib/business-rules'
import { explainPgError } from '@/lib/supabase-errors'
import type { OrderPurchaseDecisionInsert } from '@/types/database'

interface DecisionInput {
  model_code: string
  brand: string
  std_snapshot: number
  needed_qty: number
  packages_wholesale: number
  qty_retail: number
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * PUT /api/orders/[id]/purchase-decisions — reemplaza el set COMPLETO de
 * decisiones de compra de la orden (ADR-018). El body ES el estado deseado:
 * upsert por (order_id, model_code, brand) + limpieza de las que ya no vienen
 * (así se purgan también las decisiones huérfanas).
 *
 * Orden upsert → delete a propósito: si la limpieza falla quedan filas de más
 * (inofensivas, salen como huérfanas en el plan) en vez de decisiones perdidas.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data: order } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', id)
      .single()

    if (!order) return notFound('Orden no encontrada')
    if (['completed', 'cancelled'].includes(order.status)) {
      return badRequest('No se puede modificar una orden completada o cancelada')
    }

    const body = (await request.json()) as { decisions?: DecisionInput[] }
    if (!Array.isArray(body.decisions)) {
      return badRequest('El body debe incluir un array "decisions"')
    }

    // ── Validación + normalización por fila ────────────────────────────
    const seen = new Set<string>()
    const rows: OrderPurchaseDecisionInsert[] = []

    for (const d of body.decisions) {
      const model_code = normalizeCatalogCode(d.model_code)
      const brand = normalizeCatalogBrand(d.brand)
      if (!model_code) {
        return badRequest('Hay una decisión sin código de modelo')
      }
      if (!isNonNegativeInt(d.std_snapshot) || d.std_snapshot < 1) {
        return badRequest(`Decisión de "${model_code}": STD inválido`)
      }
      if (!isNonNegativeInt(d.needed_qty) || d.needed_qty < 1) {
        return badRequest(`Decisión de "${model_code}": la necesidad debe ser mayor a 0`)
      }
      if (!isNonNegativeInt(d.packages_wholesale) || !isNonNegativeInt(d.qty_retail)) {
        return badRequest(`Decisión de "${model_code}": cantidades inválidas`)
      }
      // Pre-flight del CHECK check_decision_covers_needed, con mensaje claro.
      if (d.packages_wholesale * d.std_snapshot + d.qty_retail < d.needed_qty) {
        return badRequest(
          `Decisión de "${model_code}": no cubre la necesidad (${d.packages_wholesale} paq × ${d.std_snapshot} + ${d.qty_retail} < ${d.needed_qty})`,
        )
      }

      const key = `${brand}|${model_code}`
      if (seen.has(key)) {
        return badRequest(`Decisión duplicada para "${model_code}" (${brand})`)
      }
      seen.add(key)

      rows.push({
        order_id: id,
        model_code,
        brand,
        std_snapshot: d.std_snapshot,
        needed_qty: d.needed_qty,
        packages_wholesale: d.packages_wholesale,
        qty_retail: d.qty_retail,
        decided_at: new Date().toISOString(),
      })
    }

    // ── Upsert (no destructivo primero) ────────────────────────────────
    let saved: unknown[] = []
    if (rows.length > 0) {
      const { data, error: upsertError } = await supabase
        .from('order_purchase_decisions')
        .upsert(rows, { onConflict: 'order_id,model_code,brand' })
        .select()

      if (upsertError) {
        console.error('purchase-decisions upsert error:', upsertError)
        const explanation = explainPgError(upsertError)
        return explanation.isConstraintViolation
          ? badRequest(explanation.userMessage)
          : serverError('Error al guardar las decisiones de compra')
      }
      saved = data ?? []
    }

    // ── Limpieza de decisiones que ya no vienen en el set ──────────────
    const { data: existing } = await supabase
      .from('order_purchase_decisions')
      .select('id, model_code, brand')
      .eq('order_id', id)

    const removedIds = (existing ?? [])
      .filter((row) => !seen.has(`${row.brand}|${row.model_code}`))
      .map((row) => row.id)

    if (removedIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('order_purchase_decisions')
        .delete()
        .in('id', removedIds)

      if (deleteError) {
        // Filas sobrantes son inofensivas (aparecen como huérfanas en el plan).
        console.warn('purchase-decisions cleanup error (ignored):', deleteError)
      }
    }

    return NextResponse.json({ decisions: saved })
  } catch (error) {
    console.error('purchase-decisions error:', error)
    return serverError()
  }
}
