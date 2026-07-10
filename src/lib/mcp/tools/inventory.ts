/**
 * Tools MCP del módulo Inventario (solo lectura).
 * Misma query y filtros de stock que GET /api/inventory.
 */

import { normalizePagination, ToolError, type Db } from '../shared'
import type { StoreInventory } from '@/types/database'

const STOCK_FILTERS = ['all', 'in_stock', 'low_stock', 'sin_stock'] as const
type StockFilter = (typeof STOCK_FILTERS)[number]

export interface SearchInventoryInput {
  search?: string
  stockFilter?: string
  page?: number
  pageSize?: number
}

export async function searchInventory(db: Db, input: SearchInventoryInput) {
  const { page, pageSize, from, to } = normalizePagination(input)

  let query = db.from('store_inventory').select('*', { count: 'exact' })

  const search = (input.search ?? '').replace(/[%]/g, ' ').trim()
  if (search) query = query.ilike('model_code', `%${search}%`)

  const stockFilter: StockFilter = STOCK_FILTERS.includes(input.stockFilter as StockFilter)
    ? (input.stockFilter as StockFilter)
    : 'all'
  if (stockFilter === 'sin_stock') query = query.eq('quantity', 0)
  else if (stockFilter === 'low_stock') query = query.gt('quantity', 0).lte('quantity', 5)
  else if (stockFilter === 'in_stock') query = query.gt('quantity', 5)

  const { data, error, count } = await query
    .order('model_code', { ascending: true })
    .range(from, to)

  if (error) throw new ToolError(`Error al obtener el inventario: ${error.message}`)

  const items = ((data ?? []) as StoreInventory[]).map((i) => ({
    model_code: i.model_code,
    quantity: i.quantity,
    // La ubicación (gaveta) se conserva en BD aunque quantity=0, pero solo se
    // muestra con stock — misma regla que el frontend, para no mandar a buscar
    // a una gaveta vacía.
    location: i.quantity > 0 ? i.location : null,
    updated_at: i.updated_at,
  }))

  return { items, count: count ?? 0, page, pageSize, totalPages: Math.ceil((count ?? 0) / pageSize) }
}

export async function getInventoryStats(db: Db) {
  const { data, error } = await db.from('store_inventory').select('quantity')
  if (error) throw new ToolError(`Error al obtener las métricas: ${error.message}`)

  const items = (data ?? []) as { quantity: number }[]
  return {
    total: items.length,
    sin_stock: items.filter((i) => i.quantity === 0).length,
    low_stock: items.filter((i) => i.quantity > 0 && i.quantity <= 5).length,
    in_stock: items.filter((i) => i.quantity > 5).length,
  }
}
