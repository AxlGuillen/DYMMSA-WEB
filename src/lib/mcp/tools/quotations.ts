/**
 * Tools MCP del módulo Cotizaciones (solo lectura).
 * Reutiliza las mismas queries que /api/quotations y los totales de business-rules.
 */

import { calculateLineTotal, calculateQuotationTotal, isProductItem } from '@/lib/business-rules'
import { normalizePagination, sanitizeSearch, ToolError, type Db } from '../shared'
import type { Quotation, QuotationStatus, QuotationWithItems } from '@/types/database'

const STATUSES: QuotationStatus[] = [
  'draft',
  'sent_for_approval',
  'approved',
  'rejected',
  'converted_to_order',
]

export interface ListQuotationsInput {
  status?: string
  search?: string
  page?: number
  pageSize?: number
}

export async function listQuotations(db: Db, input: ListQuotationsInput) {
  const { page, pageSize, from, to } = normalizePagination(input)

  let query = db.from('quotations').select('*, quotation_items(count)', { count: 'exact' })

  const search = sanitizeSearch(input.search ?? '')
  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,name.ilike.%${search}%`)
  }
  if (input.status && STATUSES.includes(input.status as QuotationStatus)) {
    query = query.eq('status', input.status)
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw new ToolError(`Error al obtener las cotizaciones: ${error.message}`)

  const quotations = (data ?? []).map((q) => {
    const raw = q as Quotation & { quotation_items: [{ count: number }] | null }
    return {
      id: raw.id,
      name: raw.name,
      customer_name: raw.customer_name,
      status: raw.status,
      total_amount: raw.total_amount,
      items_count: raw.quotation_items?.[0]?.count ?? 0,
      approved_at: raw.approved_at,
      created_at: raw.created_at,
    }
  })

  return { quotations, count: count ?? 0, page, pageSize, totalPages: Math.ceil((count ?? 0) / pageSize) }
}

export async function getQuotation(db: Db, id: string) {
  const { data, error } = await db
    .from('quotations')
    .select('*, quotation_items(*)')
    .eq('id', id)
    .order('sort_order', { foreignTable: 'quotation_items', ascending: true })
    .limit(5000, { foreignTable: 'quotation_items' })
    .single()

  if (error) {
    if (error.code === 'PGRST116') throw new ToolError('Cotización no encontrada')
    throw new ToolError(`Error al obtener la cotización: ${error.message}`)
  }

  const q = data as QuotationWithItems
  const items = q.quotation_items.map((i) => {
    if (!isProductItem(i)) {
      return { item_type: 'separator' as const, section_label: i.section_label }
    }
    return {
      etm: i.etm,
      model_code: i.model_code,
      brand: i.brand,
      description: i.description_es || i.description,
      // Snapshot del valor resuelto al guardar (catálogo > curada > null, ADR-013)
      dymmsa_description: i.dymmsa_description,
      quantity: i.quantity,
      unit_price: i.unit_price,
      line_total: calculateLineTotal(i.unit_price, i.quantity),
      is_approved: i.is_approved,
      is_sold: i.is_sold,
      delivery_time: i.delivery_time,
      notes: i.notes,
    }
  })

  return {
    id: q.id,
    name: q.name,
    customer_name: q.customer_name,
    status: q.status,
    notes: q.notes,
    approved_at: q.approved_at,
    created_at: q.created_at,
    updated_at: q.updated_at,
    total: calculateQuotationTotal(q.quotation_items),
    total_approved: calculateQuotationTotal(q.quotation_items, { onlyApproved: true }),
    items_count: q.quotation_items.filter(isProductItem).length,
    items,
  }
}

export async function getQuotationStats(db: Db) {
  const { data, error } = await db.from('quotations').select('status')
  if (error) throw new ToolError(`Error al obtener las métricas: ${error.message}`)

  const stats: Record<QuotationStatus, number> = {
    draft: 0,
    sent_for_approval: 0,
    approved: 0,
    rejected: 0,
    converted_to_order: 0,
  }
  ;(data ?? []).forEach((q) => {
    const s = (q as { status: QuotationStatus }).status
    if (s in stats) stats[s]++
  })
  return stats
}
