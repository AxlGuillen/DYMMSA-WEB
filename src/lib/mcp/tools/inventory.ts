/** Inventory tools (read-only): same query and stock filters as GET /api/inventory. */

import type { WritePlan } from '@/lib/mcp/core/define'
import { listResult, writeResult } from '@/lib/mcp/core/envelope'
import { findInventoryRows, setInventoryLocation, type InventoryRow } from '@/lib/inventory-store'
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

export interface SaveInventoryItemInput {
  productos: { codigo: string; ubicacion: string }[]
}

type InventoryCarry = { rows: { codigo: string; before: InventoryRow; ubicacion: string }[] }

/** Reads every code first: a typo or a collision stops the whole call before the first drawer changes. */
export async function planSaveInventoryItem(db: Db, input: SaveInventoryItemInput): Promise<WritePlan<InventoryCarry>> {
  const codes = input.productos.map((p) => p.codigo.trim())
  if (codes.some((code) => !code)) throw new ToolError('Cada producto lleva su `codigo`.')
  if (new Set(codes.map((code) => code.toLowerCase())).size !== codes.length) throw new ToolError('Un código aparece dos veces en la misma llamada.')

  const found = await Promise.all(codes.map((code) => findInventoryRows(db, code)))
  const missing = codes.filter((_, i) => found[i].length === 0)
  if (missing.length > 0) {
    throw new ToolError(
      `${missing.map((c) => `"${c}"`).join(', ')} no ${missing.length > 1 ? 'están' : 'está'} en el inventario: la ubicación solo se asigna a productos ya inventariados (search_inventory verifica el código).`,
    )
  }
  const clashes = codes.filter((_, i) => found[i].length > 1)
  if (clashes.length > 0) throw new ToolError(`${clashes.map((c) => `"${c}"`).join(', ')} coincide con varios códigos por mayúsculas/minúsculas — repórtalo, no debería pasar.`)

  const rows = input.productos.map((p, i) => ({ codigo: found[i][0].model_code, before: found[i][0], ubicacion: p.ubicacion.trim() }))
  return {
    entity: { key: 'productos', value: rows.map((r) => ({ codigo: r.codigo, cantidad: r.before.quantity, ubicacion: r.ubicacion || null })) },
    cambios: Object.fromEntries(rows.map((r) => [`ubicacion ${r.codigo}`, { antes: r.before.location, ahora: r.ubicacion || null }])),
    // A drawer is metadata, not stock: low risk, it writes at once.
    directo: true,
    fingerprint: rows.map((r) => [r.codigo, r.before.location]),
    subject: 'El inventario',
    carry: { rows },
  }
}

export async function commitSaveInventoryItem(db: Db, plan: WritePlan<InventoryCarry>) {
  const saved: InventoryRow[] = []
  for (const row of plan.carry.rows) {
    try {
      saved.push(await setInventoryLocation(db, row.codigo, row.ubicacion || null))
    } catch (error) {
      if (saved.length === 0) throw error
      const done = saved.map((s) => s.model_code).join(', ')
      throw new ToolError(`Se guardó la ubicación de ${done}, pero falló en ${row.codigo}: ${error instanceof Error ? error.message : 'error'}. Repite solo lo que falta.`)
    }
  }
  return writeResult(
    'actualizado',
    'productos',
    saved.map((s) => ({ codigo: s.model_code, cantidad: s.quantity, ubicacion: s.location })),
    { cambios: plan.cambios, nota: saved.some((s) => s.location === null) ? 'Una ubicación vacía borra la gaveta.' : undefined },
  )
}
