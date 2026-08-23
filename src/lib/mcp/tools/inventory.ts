/**
 * Tools MCP del módulo Inventario (solo lectura).
 * Misma query y filtros de stock que GET /api/inventory.
 */

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

  // Coherencia con los demás tools: aunque hoy sea .ilike() directo (no .or()),
  // sanitizeSearch mantiene el mismo saneo por si esta query cambia a futuro.
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

export interface SetInventoryLocationInput {
  model_code?: string
  location?: string | null
}

/**
 * Escritura acotada (issue #72, ADR-015): SOLO el metadato de ubicación física
 * (gaveta) de una fila EXISTENTE del inventario. Las cantidades siguen vedadas
 * vía MCP — son el núcleo transaccional. Mismo saneo que PATCH /api/inventory:
 * texto trim, vacío → null (borrar la ubicación).
 */
export async function setInventoryLocation(db: Db, input: SetInventoryLocationInput) {
  const modelCode = (input.model_code ?? '').trim()
  if (!modelCode) throw new ToolError('Indica el model_code del producto en inventario')

  const location = typeof input.location === 'string' ? (input.location.trim() || null) : null

  // ilike con comodines escapados: match exacto pero case-insensitive — las
  // filas de inventario se guardan con trim sin mayusculizar.
  const exactPattern = modelCode.replace(/[\\%_]/g, (c) => `\\${c}`)

  const { data, error } = await db
    .from('store_inventory')
    .update({ location })
    .ilike('model_code', exactPattern)
    .select('model_code, quantity, location')

  if (error) throw new ToolError(`Error al actualizar la ubicación: ${error.message}`)
  const rows = (data ?? []) as StoreInventory[]
  if (rows.length === 0) {
    // No se crea la fila: la ubicación es metadato de algo YA inventariado.
    throw new ToolError(
      `"${modelCode}" no está en el inventario — la ubicación solo se asigna a productos ya inventariados (usa search_inventory para verificar el código).`,
    )
  }
  if (rows.length > 1) {
    // model_code es UNIQUE por valor exacto: el ilike case-insensitive pudo
    // haber tocado más de una fila (p. ej. "abc" y "ABC" coexistiendo). Ya se
    // actualizaron todas — se avisa en vez de devolver solo la primera en silencio.
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
