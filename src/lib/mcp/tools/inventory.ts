/** Inventory tools (read-only): same query and stock filters as GET /api/inventory. */

import { normalizePagination, sanitizeSearch, ToolError, type Db } from '../shared'
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

  // Sanitized even though this is a plain .ilike() today, in case the query grows an .or().
  const search = sanitizeSearch(input.search ?? '')
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
    // Location is kept at quantity=0 but only shown with stock (same rule as the frontend):
    // never send anyone to an empty drawer.
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

export interface SetInventoryLocationInput {
  model_code?: string
  location?: string | null
}

/** Scoped write (#72, ADR-015): location only — quantities are off-limits. Empty clears it. */
export async function setInventoryLocation(db: Db, input: SetInventoryLocationInput) {
  const modelCode = (input.model_code ?? '').trim()
  if (!modelCode) throw new ToolError('Indica el model_code del producto en inventario')

  const location = typeof input.location === 'string' ? (input.location.trim() || null) : null

  // Escaped-wildcard ilike = exact but case-insensitive: rows are stored trimmed, not uppercased.
  const exactPattern = modelCode.replace(/[\\%_]/g, (c) => `\\${c}`)

  const { data, error } = await db
    .from('store_inventory')
    .update({ location })
    .ilike('model_code', exactPattern)
    .select('model_code, quantity, location')

  if (error) throw new ToolError(`Error al actualizar la ubicación: ${error.message}`)
  const rows = (data ?? []) as StoreInventory[]
  if (rows.length === 0) {
    // No insert: a location is metadata about something ALREADY in inventory.
    throw new ToolError(
      `"${modelCode}" no está en el inventario — la ubicación solo se asigna a productos ya inventariados (usa search_inventory para verificar el código).`,
    )
  }
  if (rows.length > 1) {
    // model_code is UNIQUE by exact value, so a case-insensitive match can hit several rows
    // ("abc" and "ABC"): all were updated — warn instead of silently returning the first.
    throw new ToolError(
      `"${modelCode}" coincide con ${rows.length} códigos distintos por mayúsculas/minúsculas — repórtalo, no debería pasar.`,
    )
  }
  const row = rows[0]

  return {
    model_code: row.model_code,
    quantity: row.quantity,
    ubicacion: row.location,
    nota: location === null ? 'Ubicación borrada.' : undefined,
  }
}
