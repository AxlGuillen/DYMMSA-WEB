/** Order tools (read). The list query lives here: there is no GET /api/orders yet. */

import { calculateOrderTotal, isProductItem } from '@/lib/business-rules'
import { DELIVERY_TIME_TOKENS } from '@/lib/delivery'
import { ORDER_STATUS_TOKENS, URREA_STATUS_TOKENS } from '@/lib/order-status'
import { sanitizeSearch } from '@/lib/text'
import { normalizePagination } from '@/lib/mcp/core/schema'
import { listResult, recordResult, refOf, versionOf } from '@/lib/mcp/core/envelope'
import { resolveByName, type NamedLookup } from '@/lib/mcp/core/lookup'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import type { Order, OrderWithItems } from '@/types/database'

export type OrderRef = Pick<Order, 'id' | 'name' | 'customer_name' | 'status'>

const ORDER_LOOKUP: NamedLookup<OrderRef> = {
  table: 'orders',
  select: 'id, name, customer_name, status',
  what: 'orden',
  article: 'la',
  label: (o) => `${o.name} (${o.customer_name})`,
  nameColumns: ['name', 'customer_name'],
}

/** The order as the cut and purchase answers name it: ref and tokens, never the UUID (#155 C6). */
export const orderBrief = (order: OrderRef) => ({
  ref: refOf(order.id),
  nombre: order.name,
  cliente: order.customer_name,
  estado: ORDER_STATUS_TOKENS.toToken(order.status),
})

/** An order by UUID, ref or (partial) name/customer — the lookup the cut and purchase tools share (#109, #155 C6). */
export const resolveOrder = (db: Db, ref: string): Promise<OrderRef> => resolveByName(db, ORDER_LOOKUP, ref)

export interface ListOrdersInput {
  estado?: string
  buscar?: string
  pagina?: number
  por_pagina?: number
}

export async function listOrders(db: Db, input: ListOrdersInput) {
  // An unknown status is an error, never a filter dropped in silence (#155 C1).
  const status = input.estado === undefined ? undefined : ORDER_STATUS_TOKENS.toDb(input.estado)
  if (input.estado !== undefined && !status) {
    throw new ToolError(`Estado inválido "${input.estado}": usa ${ORDER_STATUS_TOKENS.tokens.join(' | ')}`)
  }
  const { pagina, por_pagina, from, to } = normalizePagination(input)

  let query = db.from('orders').select('*, order_items(count)', { count: 'exact' })

  const search = sanitizeSearch(input.buscar ?? '')
  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,name.ilike.%${search}%`)
  }
  if (status) query = query.eq('status', status)

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw new ToolError(`Error al obtener las órdenes: ${error.message}`)

  const orders = (data ?? []).map((o) => {
    const raw = o as Order & { order_items: [{ count: number }] | null }
    return {
      ref: refOf(raw.id),
      nombre: raw.name,
      cliente: raw.customer_name,
      estado: ORDER_STATUS_TOKENS.toToken(raw.status),
      // Sealed when the order was made or last edited; get_order recomputes it from the lines.
      total_sellado: raw.total_amount,
      cotizacion: raw.quotation_id ? { ref: refOf(raw.quotation_id) } : null,
      lineas: raw.order_items?.[0]?.count ?? 0,
      creada_el: raw.created_at,
    }
  })

  return listResult('ordenes', orders, { total: count ?? 0, pagina, por_pagina })
}

export async function getOrder(db: Db, reference: string) {
  const { id } = await resolveOrder(db, reference)
  const { data, error } = await db
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', id)
    .order('sort_order', { foreignTable: 'order_items', ascending: true })
    .limit(5000, { foreignTable: 'order_items' })
    .single()

  if (error) {
    if (error.code === 'PGRST116') throw new ToolError('Orden no encontrada')
    throw new ToolError(`Error al obtener la orden: ${error.message}`)
  }

  const o = data as OrderWithItems
  const products = o.order_items.filter(isProductItem)
  // linea = position over ALL rows, sections included (plan §4.5): what a later edit names.
  const lineas = o.order_items.map((i, index) => {
    if (!isProductItem(i)) {
      return { linea: index + 1, tipo: 'seccion' as const, titulo: i.section_label }
    }
    return {
      linea: index + 1,
      tipo: 'producto' as const,
      etm: i.etm,
      codigo: i.model_code,
      marca: i.brand,
      descripcion: i.description,
      cantidad_aprobada: i.quantity_approved,
      en_stock: i.quantity_in_stock,
      por_pedir: i.quantity_to_order,
      recibida: i.quantity_received,
      estado_urrea: URREA_STATUS_TOKENS.toToken(i.urrea_status),
      entrega: i.delivery_time ? DELIVERY_TIME_TOKENS.toToken(i.delivery_time) : null,
      precio: i.unit_price,
      ubicacion: i.location,
    }
  })

  return recordResult(
    {
      nombre: o.name,
      cliente: o.customer_name,
      estado: ORDER_STATUS_TOKENS.toToken(o.status),
      cotizacion: o.quotation_id ? { ref: refOf(o.quotation_id) } : null,
      notas: o.notes,
      creada_el: o.created_at,
      actualizada_el: o.updated_at,
      version: versionOf(o.updated_at, o.order_items.map((i) => i.id)),
      total: calculateOrderTotal(products),
      productos: products.length,
      pendientes_con_urrea: products.filter((i) => i.urrea_status === 'pending' && i.quantity_to_order > 0).length,
      lineas,
    },
    { ref: refOf(o.id) },
  )
}

/** The order a quotation was converted into, or null; get_quotation carries it since #134 (ADR-034, second stage). */
export async function findOrderByQuotation(db: Db, quotationId: string): Promise<Pick<Order, 'id' | 'name' | 'status'> | null> {
  const { data, error } = await db
    .from('orders')
    .select('id, name, status')
    .eq('quotation_id', quotationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new ToolError(`Error al buscar la orden: ${error.message}`)
  return (data as Pick<Order, 'id' | 'name' | 'status'> | null) ?? null
}
