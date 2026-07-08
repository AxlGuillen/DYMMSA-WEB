import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculateQuotationTotal, isProductItem } from '@/lib/business-rules'
import { requireAuth } from '@/lib/api-helpers'
import { processAutoLearn } from '@/lib/auto-learn'
import { explainPgError } from '@/lib/supabase-errors'
import type { QuotationItemRow } from '@/types/database'

interface SaveQuotationInput {
  name: string
  customer_name: string
  items: QuotationItemRow[]
}

// ------------------------------------------------------------------ //
// POST /api/quotations/save                                           //
// ------------------------------------------------------------------ //
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error
    const { user } = auth

    const { name, customer_name, items } = (await request.json()) as SaveQuotationInput

    if (!name?.trim()) {
      return NextResponse.json(
        { message: 'El nombre de la cotización es requerido' },
        { status: 400 }
      )
    }
    if (!customer_name?.trim()) {
      return NextResponse.json(
        { message: 'El nombre del cliente es requerido' },
        { status: 400 }
      )
    }
    const hasProduct = items?.some(isProductItem)
    if (!hasProduct) {
      return NextResponse.json(
        { message: 'Se requiere al menos un producto' },
        { status: 400 }
      )
    }

    // Total parcial: solo productos con precio y cantidad (separadores excluidos)
    const total_amount = calculateQuotationTotal(items)

    // ── 1. Crear quotation ──────────────────────────────────────────
    const { data: quotation, error: quotationError } = await supabase
      .from('quotations')
      .insert({
        name:          name.trim(),
        customer_name: customer_name.trim(),
        status:        'draft',
        total_amount,
        created_by:    user.id,
      })
      .select()
      .single()

    if (quotationError || !quotation) {
      console.error('Error creating quotation:', quotationError)
      return NextResponse.json(
        { message: 'Error al crear la cotización' },
        { status: 500 }
      )
    }

    // ── 2. Crear quotation_items ────────────────────────────────────
    const quotationItems = items.map((item, index) => ({
      quotation_id:   quotation.id,
      item_type:      item.item_type      ?? 'product',
      section_label:  item.item_type === 'separator' ? (item.section_label ?? null) : null,
      etm:            item.item_type === 'separator' ? null : (item.etm || null),
      description:    item.item_type === 'separator' ? null : (item.description || null),
      description_es: item.item_type === 'separator' ? null : (item.description_es || null),
      model_code:     item.item_type === 'separator' ? null : (item.model_code || null),
      brand:          item.item_type === 'separator' ? null : (item.brand || null),
      unit_price:     item.item_type === 'separator' ? null : item.unit_price,
      quantity:       item.item_type === 'separator' ? null : item.quantity,
      delivery_time:  item.item_type === 'separator' ? null : (item.delivery_time ?? 'immediate'),
      is_approved:    null,
      is_sold:        item.item_type === 'separator' ? null : (item.is_sold ?? null),
      sort_order:     index,
    }))

    const { error: itemsError } = await supabase
      .from('quotation_items')
      .insert(quotationItems)

    if (itemsError) {
      console.error('Error creating quotation items:', itemsError)
      // Rollback: eliminar la cotización recién creada
      await supabase.from('quotations').delete().eq('id', quotation.id)
      // Mapear el error de Postgres a un mensaje accionable identificando el ítem ofensor.
      const info = explainPgError(itemsError, items)
      return NextResponse.json(
        { message: info.userMessage, offendingEtm: info.offendingEtm },
        { status: info.isConstraintViolation ? 400 : 500 }
      )
    }

    // ── 3. Auto-aprendizaje en etm_products ─────────────────────────
    // Aislado: si falla, la cotización ya está guardada; reportamos warning
    // en vez de tirar 500 y confundir al usuario.
    let autoLearn = { added: 0, updated: 0, skipped: 0 }
    let autoLearnFailed = false
    try {
      autoLearn = await processAutoLearn(supabase, user.id, items)
    } catch (err) {
      console.error('Auto-learn failed (quotation already saved):', err)
      autoLearnFailed = true
    }

    return NextResponse.json({
      quotation_id: quotation.id,
      total_amount,
      items_count:  items.length,
      auto_learn:   autoLearn,
      ...(autoLearnFailed && { warning: 'auto_learn_failed' }),
    })
  } catch (error) {
    console.error('Save quotation error:', error)
    return NextResponse.json(
      { message: 'Error al guardar la cotización' },
      { status: 500 }
    )
  }
}
