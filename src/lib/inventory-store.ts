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
