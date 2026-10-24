/** Store inventory writes the MCP shares with the app (#155 C6): today only the drawer; quantities arrive with phase D. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DomainError, type DomainErrorKind } from '@/lib/domain-error'
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

/**
 * A location is metadata about something ALREADY in inventory: no insert, and quantities are untouched.
 * `location` empty or null clears it; the drawer survives a quantity of 0 (CLAUDE.md).
 */
export async function setInventoryLocation(db: SupabaseClient, modelCode: string, location: string | null): Promise<InventoryRow> {
  const code = modelCode.trim()
  if (!code) throw new InventoryError('Indica el código del producto en inventario')
  const { data, error } = await db
    .from('store_inventory')
    .update({ location: location?.trim() || null })
    .ilike('model_code', exactPattern(code))
    .select('model_code, quantity, location')
  if (error) {
    console.error('Error updating store_inventory location:', error)
    throw new InventoryError('Error al actualizar la ubicación', 'failed')
  }
  const rows = (data ?? []) as InventoryRow[]
  if (rows.length === 0) throw new InventoryError(`"${code}" no está en el inventario: la ubicación solo se asigna a productos ya inventariados.`, 'not_found')
  // model_code is UNIQUE by exact value, so a case-insensitive match can hit several rows ("abc" and "ABC"): all were updated.
  if (rows.length > 1) {
    throw new InventoryError(`"${code}" coincide con ${rows.length} códigos distintos por mayúsculas/minúsculas — repórtalo, no debería pasar.`, 'conflict')
  }
  return rows[0]
}
