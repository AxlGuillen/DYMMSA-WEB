import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { QuotationItemRow } from '@/types/database'

interface UpdateQuotationInput {
  customer_name: string
  items: QuotationItemRow[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processAutoLearn(supabase: any, userId: string, items: QuotationItemRow[]) {
  const eligible = items.filter((i) => i.etm && (i.model_code || i.description))
  if (eligible.length === 0) return

  const etmCodes = eligible.map((i) => i.etm)
  const { data: existing } = await supabase
    .from('etm_products')
    .select('id, etm, description, description_es, model_code, price, brand')
    .in('etm', etmCodes)

  const existingMap = new Map(
    (existing ?? []).map((p: { etm: string; [key: string]: unknown }) => [p.etm, p])
  )

  for (const item of eligible) {
    const dbProduct = existingMap.get(item.etm) as {
      etm: string; description: string; description_es: string
      model_code: string; price: number; brand: string
    } | undefined

    if (!dbProduct) {
      await supabase.from('etm_products').insert({
        etm:            item.etm,
        description:    item.description    || '',
        description_es: item.description_es || '',
        model_code:     item.model_code     || '',
        price:          item.unit_price     ?? 0,
        brand:          item.brand          || 'URREA',
        created_by:     userId,
      })
    } else {
      const updates: Record<string, unknown> = {}
      if (item.description    && item.description    !== dbProduct.description)    updates.description = item.description
      if (item.description_es && item.description_es !== dbProduct.description_es) updates.description_es = item.description_es
      if (item.model_code     && item.model_code     !== dbProduct.model_code)     updates.model_code = item.model_code
      if (item.brand          && item.brand          !== dbProduct.brand)          updates.brand = item.brand
      if (item.unit_price != null && item.unit_price !== dbProduct.price)          updates.price = item.unit_price

      if (Object.keys(updates).length > 0) {
        await supabase.from('etm_products').update(updates).eq('etm', item.etm)
      }
    }
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ message: 'No autorizado' }, { status: 401 })
    }

    // Verify quotation belongs to user and is draft
    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('id, status')
      .eq('id', id)
      .eq('created_by', user.id)
      .single()

    if (fetchError || !quotation) {
      return NextResponse.json({ message: 'Cotización no encontrada' }, { status: 404 })
    }

    if (quotation.status !== 'draft') {
      return NextResponse.json(
        { message: 'Solo se pueden editar cotizaciones en borrador' },
        { status: 400 }
      )
    }

    const { customer_name, items } = (await request.json()) as UpdateQuotationInput

    if (!customer_name?.trim()) {
      return NextResponse.json({ message: 'El nombre del cliente es requerido' }, { status: 400 })
    }
    if (!items?.length) {
      return NextResponse.json({ message: 'Se requiere al menos un producto' }, { status: 400 })
    }

    const total_amount = items.reduce((sum, item) => {
      if (item.unit_price != null && item.quantity != null) {
        return sum + item.unit_price * item.quantity
      }
      return sum
    }, 0)

    // Delete existing items and re-insert
    const { error: deleteError } = await supabase
      .from('quotation_items')
      .delete()
      .eq('quotation_id', id)

    if (deleteError) {
      return NextResponse.json({ message: 'Error al actualizar productos' }, { status: 500 })
    }

    const newItems = items.map((item) => ({
      quotation_id:   id,
      etm:            item.etm            || null,
      description:    item.description    || null,
      description_es: item.description_es || null,
      model_code:     item.model_code     || null,
      brand:          item.brand          || null,
      unit_price:     item.unit_price,
      quantity:       item.quantity,
      is_approved:    null,
    }))

    const { error: insertError } = await supabase.from('quotation_items').insert(newItems)

    if (insertError) {
      return NextResponse.json({ message: 'Error al guardar los productos' }, { status: 500 })
    }

    // Update quotation header
    await supabase
      .from('quotations')
      .update({ customer_name: customer_name.trim(), total_amount })
      .eq('id', id)

    // Auto-learn
    await processAutoLearn(supabase, user.id, items)

    return NextResponse.json({ quotation_id: id, total_amount, items_count: items.length })
  } catch (error) {
    console.error('Update quotation error:', error)
    return NextResponse.json({ message: 'Error al actualizar la cotización' }, { status: 500 })
  }
}
