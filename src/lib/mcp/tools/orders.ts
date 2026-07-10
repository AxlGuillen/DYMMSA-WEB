/**
 * Tools MCP del módulo Órdenes (solo lectura).
 * No existe GET /api/orders de lista (useOrders aún lee directo), así que la
 * query de lista vive aquí con la misma forma que las demás rutas.
 */

import { calculateOrderTotal, isProductItem } from '@/lib/business-rules'
import { normalizePagination, sanitizeSearch, ToolError, type Db } from '../shared'
import type { Order, OrderStatus, OrderWithItems } from '@/types/database'

const STATUSES: OrderStatus[] = ['ordered', 'received', 'delivered', 'completed', 'cancelled']

export interface ListOrdersInput {
  status?: string
  search?: string
  page?: number
  pageSize?: number
}

export async function listOrders(db: Db, input: ListOrdersInput) {
  const { page, pageSize, from, to } = normalizePagination(input)

  let query = db.from('orders').select('*, order_items(count)', { count: 'exact' })

  const search = sanitizeSearch(input.search ?? '')
  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,name.ilike.%${search}%`)
  }
  if (input.status && STATUSES.includes(input.status as OrderStatus)) {
    query = query.eq('status', input.status)
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw new ToolError(`Error al obtener las órdenes: ${error.message}`)

  const orders = (data ?? []).map((o) => {
    const raw = o as Order & { order_items: [{ count: number }] | null }
    return {
      id: raw.id,
      name: raw.name,
      customer_name: raw.customer_name,
      status: raw.status,
      total_amount: raw.total_amount,
      quotation_id: raw.quotation_id,
      items_count: raw.order_items?.[0]?.count ?? 0,
      created_at: raw.created_at,
    }
  })

  return { orders, count: count ?? 0, page, pageSize, totalPages: Math.ceil((count ?? 0) / pageSize) }
}

export async function getOrder(db: Db, id: string) {
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
  const items = o.order_items.map((i) => {
    if (!isProductItem(i)) {
      return { item_type: 'separator' as const, section_label: i.section_label }
    }
    return {
      etm: i.etm,
      model_code: i.model_code,
      brand: i.brand,
      description: i.description,
      quantity_approved: i.quantity_approved,
      quantity_in_stock: i.quantity_in_stock,
      quantity_to_order: i.quantity_to_order,
      quantity_received: i.quantity_received,
      urrea_status: i.urrea_status,
      delivery_time: i.delivery_time,
      unit_price: i.unit_price,
      location: i.location,
    }
  })

  return {
    id: o.id,
    name: o.name,
    customer_name: o.customer_name,
    status: o.status,
    quotation_id: o.quotation_id,
    notes: o.notes,
    created_at: o.created_at,
    updated_at: o.updated_at,
    total: calculateOrderTotal(products),
    items_count: products.length,
    pending_urrea_items: products.filter((i) => i.urrea_status === 'pending' && i.quantity_to_order > 0).length,
    items,
  }
}

export async function getOrderByQuotation(db: Db, quotationId: string) {
  const { data, error } = await db
    .from('orders')
    .select('id, name, status')
    .eq('quotation_id', quotationId)
    .maybeSingle()

  if (error) throw new ToolError(`Error al buscar la orden: ${error.message}`)
  return data ?? { message: 'Esta cotización no tiene una orden vinculada' }
}
