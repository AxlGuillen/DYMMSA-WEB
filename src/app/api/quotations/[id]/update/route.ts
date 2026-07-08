import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculateQuotationTotal, isProductItem, resolveDymmsaDescription } from '@/lib/business-rules'
import { requireAuth } from '@/lib/api-helpers'
import { processAutoLearn } from '@/lib/auto-learn'
import { fetchCatalogDescriptionMap } from '@/lib/urrea-catalog'
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
    // is_approved (las decisiones del cliente sobreviven a reaperturas/ediciones,
    // sin importar el estado) AND to roll back if the re-insert fails.
    const { data: existingItems } = await supabase
      .from('quotation_items')
      .select('*')
      .eq('quotation_id', id)
      .limit(5000)

    const approvalMap = new Map<string, boolean | null>()
    const soldMap = new Map<string, boolean | null>()
    const dymmsaDescMap = new Map<string, string | null>()
    for (const ei of existingItems ?? []) {
      approvalMap.set(ei.id, ei.is_approved)
      soldMap.set(ei.id, ei.is_sold)
      dymmsaDescMap.set(ei.id, ei.dymmsa_description)
    }

    // Mapa de catálogo para re-resolver la Descripción DYMMSA al re-insertar
    // (jerarquía: catálogo > curada > null).
    const catalogMap = await fetchCatalogDescriptionMap(supabase, items.map((i) => i.model_code))

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
      const lookupKey = item._dbId ?? item._id
      let is_approved: boolean | null = null
      let is_sold: boolean | null = null
      if (!isSep) {
        // Preservar la decisión del cliente (null=pendiente, true=aprobado, false=rechazado)
        // en cualquier estado: al reabrir una cotización y agregar ítems nuevos, los que ya
        // fueron aprobados se conservan y el cliente solo decide los nuevos. Se usa el valor
        // que manda la UI; fallback al valor en BD para clientes que no lo envían.
        if (item.is_approved !== undefined) {
          is_approved = item.is_approved ?? null
        } else {
          is_approved = approvalMap.has(lookupKey) ? (approvalMap.get(lookupKey) ?? null) : null
        }
        // Mismo criterio para is_sold (¿lo vendemos?): UI manda; fallback a BD.
        if (item.is_sold !== undefined) {
          is_sold = item.is_sold ?? null
        } else {
          is_sold = soldMap.has(lookupKey) ? (soldMap.get(lookupKey) ?? null) : null
        }
      }
      // Descripción DYMMSA: se re-resuelve con jerarquía de catálogo. La curada
      // viene de la UI; fallback al snapshot en BD para clientes que no la envían.
      const curated = item.dymmsa_description !== undefined
        ? item.dymmsa_description
        : (dymmsaDescMap.get(lookupKey) ?? null)
      const dymmsa_description = isSep
        ? null
        : resolveDymmsaDescription({ ...item, dymmsa_description: curated }, catalogMap).value
      return {
        quotation_id:   id,
        item_type:      item.item_type      ?? 'product',
        section_label:  isSep ? (item.section_label ?? null) : null,
        etm:            isSep ? null : (item.etm || null),
        description:    isSep ? null : (item.description || null),
        description_es: isSep ? null : (item.description_es || null),
        dymmsa_description,
        model_code:     isSep ? null : (item.model_code || null),
        brand:          isSep ? null : (item.brand || null),
        unit_price:     isSep ? null : item.unit_price,
        quantity:       isSep ? null : item.quantity,
        delivery_time:  isSep ? null : (item.delivery_time ?? 'immediate'),
        is_approved,
        is_sold,
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
