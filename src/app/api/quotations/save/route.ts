import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { QuotationItemRow } from '@/types/database'

interface SaveQuotationInput {
  customer_name: string
  items: QuotationItemRow[]
}

interface AutoLearnResult {
  added: number
  updated: number
  skipped: number
}

// ------------------------------------------------------------------ //
// Auto-learn: INSERT new ETMs, UPDATE existing ones if data changed   //
// ------------------------------------------------------------------ //
async function processAutoLearn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  items: QuotationItemRow[]
): Promise<AutoLearnResult> {
  const result: AutoLearnResult = { added: 0, updated: 0, skipped: 0 }

  // Only process items that have etm + at least model_code or description
  const eligible = items.filter(
    (item) => item.etm && (item.model_code || item.description)
  )
  if (eligible.length === 0) return result

  // Fetch all existing records in one query
  const etmCodes = eligible.map((i) => i.etm)
  const { data: existingProducts } = await supabase
    .from('etm_products')
    .select('id, etm, description, description_es, model_code, price, brand')
    .in('etm', etmCodes)

  const existingMap = new Map(
    (existingProducts ?? []).map((p: { etm: string; [key: string]: unknown }) => [p.etm, p])
  )

  for (const item of eligible) {
    const existing = existingMap.get(item.etm) as {
      id: string
      etm: string
      description: string
      description_es: string
      model_code: string
      price: number
      brand: string
    } | undefined

    if (!existing) {
      // ── INSERT ──────────────────────────────────────────────────────
      const { error } = await supabase.from('etm_products').insert({
        etm:            item.etm,
        description:    item.description    || '',
        description_es: item.description_es || '',
        model_code:     item.model_code     || '',
        price:          item.unit_price     ?? 0,
        brand:          item.brand          || 'URREA',
        created_by:     userId,
      })

      if (error) {
        console.error('Auto-learn insert error:', error)
        result.skipped++
      } else {
        result.added++
      }
    } else {
      // ── UPDATE: only non-empty fields that actually changed ─────────
      const updates: Record<string, unknown> = {}

      if (item.description    && item.description    !== existing.description)
        updates.description = item.description
      if (item.description_es && item.description_es !== existing.description_es)
        updates.description_es = item.description_es
      if (item.model_code     && item.model_code     !== existing.model_code)
        updates.model_code = item.model_code
      if (item.brand          && item.brand          !== existing.brand)
        updates.brand = item.brand
      if (item.unit_price != null && item.unit_price !== existing.price)
        updates.price = item.unit_price

      if (Object.keys(updates).length === 0) {
        result.skipped++ // nothing changed
        continue
      }

      const { error } = await supabase
        .from('etm_products')
        .update(updates)
        .eq('etm', item.etm)

      if (error) {
        console.error('Auto-learn update error:', error)
        result.skipped++
      } else {
        result.updated++
      }
    }
  }

  return result
}

// ------------------------------------------------------------------ //
// POST /api/quotations/save                                           //
// ------------------------------------------------------------------ //
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ message: 'No autorizado' }, { status: 401 })
    }

    const { customer_name, items } = (await request.json()) as SaveQuotationInput

    if (!customer_name?.trim()) {
      return NextResponse.json(
        { message: 'El nombre del cliente es requerido' },
        { status: 400 }
      )
    }
    if (!items?.length) {
      return NextResponse.json(
        { message: 'Se requiere al menos un producto' },
        { status: 400 }
      )
    }

    // Total parcial: solo items con precio y cantidad
    const total_amount = items.reduce((sum, item) => {
      if (item.unit_price != null && item.quantity != null) {
        return sum + item.unit_price * item.quantity
      }
      return sum
    }, 0)

    // ── 1. Crear quotation ──────────────────────────────────────────
    const { data: quotation, error: quotationError } = await supabase
      .from('quotations')
      .insert({
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
    const quotationItems = items.map((item) => ({
      quotation_id:   quotation.id,
      etm:            item.etm            || null,
      description:    item.description    || null,
      description_es: item.description_es || null,
      model_code:     item.model_code     || null,
      brand:          item.brand          || null,
      unit_price:     item.unit_price,
      quantity:       item.quantity,
      is_approved:    null,
    }))

    const { error: itemsError } = await supabase
      .from('quotation_items')
      .insert(quotationItems)

    if (itemsError) {
      console.error('Error creating quotation items:', itemsError)
      // Rollback: eliminar la cotización recién creada
      await supabase.from('quotations').delete().eq('id', quotation.id)
      return NextResponse.json(
        { message: 'Error al guardar los productos' },
        { status: 500 }
      )
    }

    // ── 3. Auto-aprendizaje en etm_products ─────────────────────────
    const autoLearn = await processAutoLearn(supabase, user.id, items)

    return NextResponse.json({
      quotation_id: quotation.id,
      total_amount,
      items_count:  items.length,
      auto_learn:   autoLearn,
    })
  } catch (error) {
    console.error('Save quotation error:', error)
    return NextResponse.json(
      { message: 'Error al guardar la cotización' },
      { status: 500 }
    )
  }
}
