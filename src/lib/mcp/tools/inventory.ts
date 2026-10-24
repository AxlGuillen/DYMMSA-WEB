/** Inventory tools (read-only): same query and stock filters as GET /api/inventory. */

import { listResult } from '@/lib/mcp/core/envelope'
import { normalizePagination } from '@/lib/mcp/core/schema'
import { sanitizeSearch } from '@/lib/text'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import { STOCK_FILTER_TOKENS } from '@/lib/stock-filters'
import type { StoreInventory } from '@/types/database'

export interface SearchInventoryInput {
  buscar?: string
  existencias?: string
  pagina?: number
  por_pagina?: number
}

export async function searchInventory(db: Db, input: SearchInventoryInput) {
  const stockFilter = STOCK_FILTER_TOKENS.toDb(input.existencias ?? 'todas')
  // An unknown filter is an error, never "all" in silence (#155 C1).
  if (!stockFilter) throw new ToolError(`Filtro inválido "${input.existencias}": usa ${STOCK_FILTER_TOKENS.tokens.join(' | ')}`)
  const { pagina, por_pagina, from, to } = normalizePagination(input)

  let query = db.from('store_inventory').select('*', { count: 'exact' })

  // Sanitized even though this is a plain .ilike() today, in case the query grows an .or().
  const search = sanitizeSearch(input.buscar ?? '')
  if (search) query = query.ilike('model_code', `%${search}%`)

  if (stockFilter === 'sin_stock') query = query.eq('quantity', 0)
  else if (stockFilter === 'with_stock') query = query.gt('quantity', 0)
  else if (stockFilter === 'low_stock') query = query.gt('quantity', 0).lte('quantity', 5)
  else if (stockFilter === 'in_stock') query = query.gt('quantity', 5)

  const { data, error, count } = await query
    .order('model_code', { ascending: true })
    .range(from, to)

  if (error) throw new ToolError(`Error al obtener el inventario: ${error.message}`)

  const items = ((data ?? []) as StoreInventory[]).map((i) => ({
    codigo: i.model_code,
    cantidad: i.quantity,
    // Location is kept at quantity=0 but only shown with stock (same rule as the frontend):
    // never send anyone to an empty drawer.
    ubicacion: i.quantity > 0 ? i.location : null,
    actualizado_el: i.updated_at,
  }))

  return listResult('articulos', items, { total: count ?? 0, pagina, por_pagina })
}

export async function getInventoryStats(db: Db) {
  const { data, error } = await db.from('store_inventory').select('quantity')
  if (error) throw new ToolError(`Error al obtener las métricas: ${error.message}`)

  const items = (data ?? []) as { quantity: number }[]
  return {
    total: items.length,
    [STOCK_FILTER_TOKENS.toToken('sin_stock')]: items.filter((i) => i.quantity === 0).length,
    [STOCK_FILTER_TOKENS.toToken('low_stock')]: items.filter((i) => i.quantity > 0 && i.quantity <= 5).length,
    [STOCK_FILTER_TOKENS.toToken('in_stock')]: items.filter((i) => i.quantity > 5).length,
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
