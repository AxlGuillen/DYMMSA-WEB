/** Quotation tools (read-only): same queries as /api/quotations, totals from business-rules. */

import { calculateLineTotal, calculateQuotationTotal, isProductItem } from '@/lib/business-rules'
import { DELIVERY_TIME_TOKENS } from '@/lib/delivery'
import { normalizePagination } from '@/lib/mcp/core/schema'
import { ORDER_STATUS_TOKENS } from '@/lib/order-status'
import { QUOTATION_STATUS_TOKENS } from '@/lib/quotation-status'
import { sanitizeSearch } from '@/lib/text'
import { approvalToken, soldToken } from '@/lib/tokens'
import { listResult, recordResult, refOf, versionOf } from '@/lib/mcp/core/envelope'
import { resolveByName, type NamedLookup } from '@/lib/mcp/core/lookup'
import { ToolError } from '@/lib/mcp/core/errors'
import { appUrl } from '@/lib/mcp/core/env'
import type { Db } from '@/lib/mcp/core/db'
import { findOrderByQuotation } from './orders'
import type { Quotation, QuotationStatus, QuotationWithItems } from '@/types/database'

type QuotationRef = Pick<Quotation, 'id' | 'name' | 'customer_name' | 'status'>

const QUOTATION_LOOKUP: NamedLookup<QuotationRef> = {
  table: 'quotations',
  select: 'id, name, customer_name, status',
  what: 'cotización',
  article: 'la',
  label: (q) => `${q.name} (${q.customer_name})`,
  nameColumns: ['name', 'customer_name'],
}

/** The link the customer opens (no session): whoever holds it can approve, so only an administrator reads it. */
export const approvalLink = (token: string) => `${appUrl()}/approve/${token}`

/** A quotation by UUID, ref or (partial) name/customer (#155 C6). */
export const resolveQuotation = (db: Db, ref: string): Promise<QuotationRef> => resolveByName(db, QUOTATION_LOOKUP, ref)

export interface ListQuotationsInput {
  estado?: string
  buscar?: string
  pagina?: number
  por_pagina?: number
}

export async function listQuotations(db: Db, input: ListQuotationsInput) {
  // An unknown status is an error, never a filter dropped in silence (#155 C1).
  const status = input.estado === undefined ? undefined : QUOTATION_STATUS_TOKENS.toDb(input.estado)
  if (input.estado !== undefined && !status) {
    throw new ToolError(`Estado inválido "${input.estado}": usa ${QUOTATION_STATUS_TOKENS.tokens.join(' | ')}`)
  }
  const { pagina, por_pagina, from, to } = normalizePagination(input)

  let query = db.from('quotations').select('*, quotation_items(count)', { count: 'exact' })

  const search = sanitizeSearch(input.buscar ?? '')
  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,name.ilike.%${search}%`)
  }
  if (status) query = query.eq('status', status)

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw new ToolError(`Error al obtener las cotizaciones: ${error.message}`)

  const quotations = (data ?? []).map((q) => {
    const raw = q as Quotation & { quotation_items: [{ count: number }] | null }
    return {
      ref: refOf(raw.id),
      nombre: raw.name,
      cliente: raw.customer_name,
      estado: QUOTATION_STATUS_TOKENS.toToken(raw.status),
      // Sealed in the row; on an approved, editable quotation it can lag the lines: get_quotation recomputes it.
      total_sellado: raw.total_amount,
      lineas: raw.quotation_items?.[0]?.count ?? 0,
      aprobada_el: raw.approved_at,
      creada_el: raw.created_at,
    }
  })

  return listResult('cotizaciones', quotations, { total: count ?? 0, pagina, por_pagina })
}

export async function getQuotation(db: Db, reference: string, opts: { admin?: boolean } = {}) {
  const { id } = await resolveQuotation(db, reference)
  const [{ data, error }, order] = await Promise.all([
    db
      .from('quotations')
      .select('*, quotation_items(*)')
      .eq('id', id)
      .order('sort_order', { foreignTable: 'quotation_items', ascending: true })
      .limit(5000, { foreignTable: 'quotation_items' })
      .single(),
    findOrderByQuotation(db, id),
  ])

  if (error) {
    if (error.code === 'PGRST116') throw new ToolError('Cotización no encontrada')
    throw new ToolError(`Error al obtener la cotización: ${error.message}`)
  }

  const q = data as QuotationWithItems
  // linea = position over ALL rows, sections included (plan §4.5): what a later edit names.
  const lineas = q.quotation_items.map((i, index) => {
    if (!isProductItem(i)) {
      return { linea: index + 1, tipo: 'seccion' as const, titulo: i.section_label }
    }
    return {
      linea: index + 1,
      tipo: 'producto' as const,
      etm: i.etm,
      codigo: i.model_code,
      marca: i.brand,
      descripcion: i.description_es || i.description,
      // Snapshot resolved at save time (catalog > curated > null, ADR-013)
      descripcion_dymmsa: i.dymmsa_description,
      cantidad: i.quantity,
      precio: i.unit_price,
      importe: calculateLineTotal(i.unit_price, i.quantity),
      aprobacion: approvalToken(i.is_approved),
      se_vende: soldToken(i.is_sold),
      entrega: i.delivery_time ? DELIVERY_TIME_TOKENS.toToken(i.delivery_time) : null,
      notas: i.notes,
    }
  })

  return recordResult(
    {
      nombre: q.name,
      cliente: q.customer_name,
      estado: QUOTATION_STATUS_TOKENS.toToken(q.status),
      notas: q.notes,
      aprobada_el: q.approved_at,
      creada_el: q.created_at,
      actualizada_el: q.updated_at,
      version: versionOf(q.updated_at, q.quotation_items.map((i) => i.id)),
      // The link is a credential (whoever holds it can approve): only an administrator, and only while it is alive (#155 D).
      ...(opts.admin && q.status === 'sent_for_approval' ? { link_aprobacion: approvalLink(q.approval_token) } : {}),
      orden: order ? { ref: refOf(order.id), nombre: order.name, estado: ORDER_STATUS_TOKENS.toToken(order.status) } : null,
      total: calculateQuotationTotal(q.quotation_items),
      total_aprobado: calculateQuotationTotal(q.quotation_items, { onlyApproved: true }),
      productos: q.quotation_items.filter(isProductItem).length,
      lineas,
    },
    { ref: refOf(q.id) },
  )
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
