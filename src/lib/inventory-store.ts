/** Store inventory writes the MCP shares with the app (#155 C6): today only the drawer; quantities arrive with phase D. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DomainError, type DomainErrorKind } from '@/lib/domain-error'
import { computeRestoration } from '@/lib/inventory'
import type { StoreInventory } from '@/types/database'

export class InventoryError extends DomainError {
  constructor(message: string, kind: DomainErrorKind = 'invalid') {
    super(message, kind)
    this.name = 'InventoryError'
  }
}

export type InventoryRow = Pick<StoreInventory, 'model_code' | 'quantity' | 'location'>

/** Escaped-wildcard ilike = exact but case-insensitive: rows are stored trimmed, not uppercased. */
const exactPattern = (modelCode: string) => modelCode.replace(/[\\%_]/g, (c) => `\\${c}`)

/** The rows whose code is `modelCode` ignoring case: 0 = not inventoried, 2+ = a case collision that should not exist. */
export async function findInventoryRows(db: SupabaseClient, modelCode: string): Promise<InventoryRow[]> {
  const { data, error } = await db
    .from('store_inventory')
    .select('model_code, quantity, location')
    .ilike('model_code', exactPattern(modelCode.trim()))
  if (error) {
    console.error('Error reading store_inventory:', error)
    throw new InventoryError('Error al leer el inventario', 'failed')
  }
  return (data ?? []) as InventoryRow[]
}

/** POST /api/inventory: a new code with its quantity (never negative, whole) and optional drawer. */
export async function createInventoryItem(db: SupabaseClient, body: unknown): Promise<StoreInventory> {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const modelCode = typeof raw.model_code === 'string' ? raw.model_code.trim() : ''
  if (!modelCode) throw new InventoryError('El código modelo es obligatorio')
  const quantity = typeof raw.quantity === 'number' ? Math.max(0, Math.trunc(raw.quantity)) : 0
  const location = typeof raw.location === 'string' ? raw.location.trim() || null : null

  const { data, error } = await db.from('store_inventory').insert({ model_code: modelCode, quantity, location }).select().single()
  if (error) {
    if (error.code === '23505') throw new InventoryError('Ya existe un producto con ese código modelo')
    console.error('Error creating store_inventory item:', error)
    throw new InventoryError('Error al crear el producto', 'failed')
  }
  return data as StoreInventory
}

/** PATCH /api/inventory/[id]: the quantity is ABSOLUTE here (the app's grid); the assistant counts through changeStock. */
export async function updateInventoryItem(db: SupabaseClient, id: string, body: unknown): Promise<StoreInventory> {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const updates: Record<string, unknown> = {}
  if (typeof raw.model_code === 'string') {
    const modelCode = raw.model_code.trim()
    if (!modelCode) throw new InventoryError('El código modelo no puede estar vacío')
    updates.model_code = modelCode
  }
  if (raw.quantity !== undefined) {
    if (typeof raw.quantity !== 'number' || raw.quantity < 0) throw new InventoryError('La cantidad debe ser ≥ 0')
    updates.quantity = Math.trunc(raw.quantity)
  }
  if (raw.location !== undefined) updates.location = typeof raw.location === 'string' ? raw.location.trim() || null : null
  if (Object.keys(updates).length === 0) throw new InventoryError('No hay cambios para aplicar')

  const { data, error } = await db.from('store_inventory').update(updates).eq('id', id).select().single()
  if (error) {
    if (error.code === '23505') throw new InventoryError('Ya existe un producto con ese código modelo')
    if (error.code === 'PGRST116') throw new InventoryError('Producto no encontrado', 'not_found')
    console.error('Error updating store_inventory item:', error)
    throw new InventoryError('Error al actualizar el producto', 'failed')
  }
  return data as StoreInventory
}

/**
 * What open orders still hold of each code in the store (decision 6 of #155 D). Derived, not invented: the orders
 * whose goods are still in the store (goodsInStore: pedida / recibida) give back, if cancelled, exactly
 * computeRestoration() = in_stock + min(received, ordered) per code. That is physical stock that store_inventory
 * does not count as available, so a physical count of N means N − held available.
 */
export async function heldByOpenOrders(db: SupabaseClient, modelCodes: readonly string[]): Promise<Map<string, number>> {
  const held = new Map<string, number>()
  if (modelCodes.length === 0) return held
  const { data, error } = await db
    .from('order_items')
    .select('model_code, quantity_in_stock, quantity_received, quantity_to_order, item_type, orders!inner(status)')
    .in('model_code', [...modelCodes])
    .in('orders.status', ['ordered', 'received'])
    .limit(5000)
  if (error) {
    console.error('Error reading held stock:', error)
    throw new InventoryError('Error al revisar lo apartado en órdenes', 'failed')
  }
  const lines = ((data ?? []) as (RestorableLine & { item_type: string | null })[]).filter((line) => line.item_type !== 'separator')
  for (const { model_code, quantityToRestore } of computeRestoration(lines)) held.set(model_code, (held.get(model_code) ?? 0) + quantityToRestore)
  return held
}

type RestorableLine = Parameters<typeof computeRestoration>[0][number]

export type StockChange =
  | { mode: 'delta'; value: number }
  /** Physical count already minus what orders hold; `expected` is the available stock the summary read. */
  | { mode: 'count'; value: number; expected: number }

export interface StockChangeResult {
  quantity: number | null
  /** delta: a negative delta went below 0 and was clamped. */
  clamped: boolean
  /** count: nothing written because the quantity is no longer the one the summary read. */
  stale: boolean
  /** delta of a negative amount on a code that is not in inventory. */
  missing: boolean
}

const RULE_MESSAGES: Record<string, string> = {
  empty_code: 'Indica el código del producto',
  reason_required: 'Todo cambio de cantidad lleva su motivo',
  negative_count: 'La cantidad no puede quedar negativa',
}

/** The one door for the assistant's quantity changes: change_store_stock states why and leaves the audit event (decision 7). */
export async function changeStock(db: SupabaseClient, modelCode: string, change: StockChange, reason: string): Promise<StockChangeResult> {
  const { data, error } = await db.rpc('change_store_stock', {
    p_model_code: modelCode,
    p_mode: change.mode,
    p_value: change.value,
    p_expected: change.mode === 'count' ? change.expected : null,
    p_reason: reason,
  })
  if (error) {
    const rule = error.code === 'P0001' ? RULE_MESSAGES[error.message] : undefined
    if (rule) throw new InventoryError(rule)
    console.error('change_store_stock error:', error)
    throw new InventoryError('Error al cambiar la cantidad', 'failed')
  }
  const out = (data ?? {}) as { quantity?: unknown; clamped?: unknown; changed?: unknown; missing?: unknown }
  const quantity = typeof out.quantity === 'number' ? out.quantity : null
  return {
    quantity,
    clamped: out.clamped === true,
    stale: change.mode === 'count' && out.changed === false && out.missing !== true,
    missing: out.missing === true,
  }
}

/**
 * A location is metadata about something ALREADY in inventory: no insert, and quantities are untouched.
 * `location` empty or null clears it; the drawer survives a quantity of 0 (CLAUDE.md).
 */
export async function setInventoryLocation(db: SupabaseClient, modelCode: string, location: string | null): Promise<InventoryRow> {
  const code = modelCode.trim()
  if (!code) throw new InventoryError('Indica el código del producto en inventario')
  // Check first, write second: a case collision ("abc" and "ABC") must be reported before any row changes.
  const found = await findInventoryRows(db, code)
  if (found.length === 0) throw new InventoryError(`"${code}" no está en el inventario: la ubicación solo se asigna a productos ya inventariados.`, 'not_found')
  if (found.length > 1) {
    throw new InventoryError(`"${code}" coincide con ${found.length} códigos distintos por mayúsculas/minúsculas — repórtalo, no debería pasar.`, 'conflict')
  }
  const { data, error } = await db
    .from('store_inventory')
    .update({ location: location?.trim() || null })
    .eq('model_code', found[0].model_code)
    .select('model_code, quantity, location')
  if (error) {
    console.error('Error updating store_inventory location:', error)
    throw new InventoryError('Error al actualizar la ubicación', 'failed')
  }
  const rows = (data ?? []) as InventoryRow[]
  if (rows.length === 0) throw new InventoryError(`"${code}" ya no está en el inventario.`, 'not_found')
  return rows[0]
}
