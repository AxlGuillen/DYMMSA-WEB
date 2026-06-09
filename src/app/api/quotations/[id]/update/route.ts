import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculateQuotationTotal, isProductItem } from '@/lib/business-rules'
import { requireAuth } from '@/lib/api-helpers'
import { processAutoLearn } from '@/lib/auto-learn'
import { explainPgError } from '@/lib/supabase-errors'
import type { QuotationItemRow } from '@/types/database'

interface UpdateQuotationInput {
  name: string
  customer_name: string
  items: QuotationItemRow[]
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error
    const { user } = auth

    // Verify quotation exists and is editable
    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('id, status')
      .eq('id', id)
      .single()

    if (fetchError || !quotation) {
      return NextResponse.json({ message: 'Cotización no encontrada' }, { status: 404 })
    }

    if (
      quotation.status !== 'draft' &&
      quotation.status !== 'sent_for_approval' &&
      quotation.status !== 'approved'
    ) {
      return NextResponse.json(
        { message: 'Solo se pueden editar cotizaciones en borrador, en aprobación o aprobadas' },
        { status: 400 }
      )
    }

    const { name, customer_name, items } = (await request.json()) as UpdateQuotationInput

    if (!name?.trim()) {
      return NextResponse.json({ message: 'El nombre de la cotización es requerido' }, { status: 400 })
    }
    if (!customer_name?.trim()) {
      return NextResponse.json({ message: 'El nombre del cliente es requerido' }, { status: 400 })
    }
    const hasProduct = items?.some(isProductItem)
    if (!hasProduct) {
      return NextResponse.json({ message: 'Se requiere al menos un producto' }, { status: 400 })
    }

    const total_amount = calculateQuotationTotal(items)

    // Read existing items before the destructive delete: used to preserve
    // is_approved on approved quotations AND to roll back if the re-insert fails.
    const { data: existingItems } = await supabase
      .from('quotation_items')
      .select('*')
      .eq('quotation_id', id)

    const approvalMap = new Map<string, boolean | null>()
    if (quotation.status === 'approved') {
      for (const ei of existingItems ?? []) {
        approvalMap.set(ei.id, ei.is_approved)
      }
    }

    // Delete existing items and re-insert
    const { error: deleteError } = await supabase
      .from('quotation_items')
      .delete()
      .eq('quotation_id', id)

    if (deleteError) {
      return NextResponse.json({ message: 'Error al actualizar productos' }, { status: 500 })
    }

    const newItems = items.map((item, index) => {
      const isSep = item.item_type === 'separator'
      let is_approved: boolean | null = null
      if (!isSep && quotation.status === 'approved') {
        // Use the approval value set by the user in the UI (null=pending, true=approved, false=rejected).
        // is_approved is always present on QuotationItemRow for approved quotations (set via toItemRow or
        // defaulted to null for new items). Fallback to approvalMap for legacy clients that don't send it.
        if (item.is_approved !== undefined) {
          is_approved = item.is_approved ?? null
        } else {
          const lookupKey = item._dbId ?? item._id
          is_approved = approvalMap.has(lookupKey) ? (approvalMap.get(lookupKey) ?? null) : null
        }
      }
      return {
        quotation_id:   id,
        item_type:      item.item_type      ?? 'product',
        section_label:  isSep ? (item.section_label ?? null) : null,
        etm:            isSep ? null : (item.etm || null),
        description:    isSep ? null : (item.description || null),
        description_es: isSep ? null : (item.description_es || null),
        model_code:     isSep ? null : (item.model_code || null),
        brand:          isSep ? null : (item.brand || null),
        unit_price:     isSep ? null : item.unit_price,
        quantity:       isSep ? null : item.quantity,
        delivery_time:  isSep ? null : (item.delivery_time ?? 'immediate'),
        is_approved,
        sort_order:     index,
      }
    })

    const { error: insertError } = await supabase.from('quotation_items').insert(newItems)

    if (insertError) {
      // Rollback: the delete already wiped the items, so restore the originals.
      if (existingItems?.length) {
        await supabase.from('quotation_items').insert(existingItems)
      }
      const info = explainPgError(insertError, items)
      return NextResponse.json(
        { message: info.userMessage, offendingEtm: info.offendingEtm },
        { status: info.isConstraintViolation ? 400 : 500 }
      )
    }

    // Update quotation header
    await supabase
      .from('quotations')
      .update({ name: name.trim(), customer_name: customer_name.trim(), total_amount })
      .eq('id', id)

    // Auto-learn aislado: si falla, la actualización ya está hecha; warning en vez de 500.
    let autoLearnFailed = false
    try {
      await processAutoLearn(supabase, user.id, items)
    } catch (err) {
      console.error('Auto-learn failed (quotation already updated):', err)
      autoLearnFailed = true
    }

    return NextResponse.json({
      quotation_id: id,
      total_amount,
      items_count: items.length,
      ...(autoLearnFailed && { warning: 'auto_learn_failed' }),
    })
  } catch (error) {
    console.error('Update quotation error:', error)
    return NextResponse.json({ message: 'Error al actualizar la cotización' }, { status: 500 })
  }
}
