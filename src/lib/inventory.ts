/** Inventory: pure rules plus the atomic stock functions of the DB (#157) — never read → compute → write. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { receivedForCustomer, stockKey } from '@/lib/business-rules'
import type { OrderStatus } from '@/types/database'

/** The goods are still in the store: cancel already returned them, and a delivered/completed order
 *  left with the customer (ADR-010). Only here can an order be cancelled or gain/lose lines (#157). */
export function goodsInStore(status: OrderStatus): boolean {
  return status === 'ordered' || status === 'received'
}

/** Deleting returns stock only while the goods are still in the store. */
export function deleteRestoresStock(status: OrderStatus): boolean {
  return goodsInStore(status)
}

/** Completed or cancelled: read-only (no edits, reception or new lines). */
export function isOrderClosed(status: OrderStatus): boolean {
  return status === 'completed' || status === 'cancelled'
}

type RestorableItem = {
  model_code: string | null
  quantity_in_stock: number
  quantity_received: number
  quantity_to_order: number
}

/** Restore on cancel/delete: stock taken + min(received, ordered). The excess is NOT restored —
 *  it already entered on reception and adding it back would duplicate it (ADR-019). */
export function computeRestoration<T extends RestorableItem>(
  items: T[]
): Array<{ model_code: string; quantityToRestore: number }> {
  return items
    .map((item) => ({
      model_code: item.model_code,
      quantityToRestore: item.quantity_in_stock + receivedForCustomer(item),
    }))
    .filter(
      (r): r is { model_code: string; quantityToRestore: number } =>
        r.model_code != null && r.model_code.trim() !== '' && r.quantityToRestore > 0
    )
}

/** A stock movement for one model_code; the DB functions sum repeated codes. */
export interface StockLine {
  model_code: string
  quantity: number
}

/** computeRestoration consolidated by model_code, as release_inventory takes it. */
export function restorationLines<T extends RestorableItem>(items: T[]): StockLine[] {
  const byCode = new Map<string, number>()
  for (const { model_code, quantityToRestore } of computeRestoration(items)) {
    byCode.set(model_code, (byCode.get(model_code) ?? 0) + quantityToRestore)
  }
  return [...byCode].map(([model_code, quantity]) => ({ model_code, quantity }))
}

export interface Reservation {
  reserved: number
  location: string | null
}

function toInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0
}

/** Takes least(stock, asked) per model_code under a row lock (#157); codes without a row reserve 0. */
export async function reserveInventory(db: SupabaseClient, lines: StockLine[]): Promise<Map<string, Reservation>> {
  const reservations = new Map<string, Reservation>()
  if (lines.length === 0) return reservations
  const { data, error } = await db.rpc('reserve_inventory', { p_lines: lines })
  if (error) throw new Error(`reserve_inventory: ${error.message}`)
  const rows: unknown = data
  for (const row of Array.isArray(rows) ? rows : []) {
    const r = row as { model_code?: unknown; reserved?: unknown; location?: unknown }
    if (typeof r.model_code !== 'string') continue
    reservations.set(r.model_code, {
      reserved: toInt(r.reserved),
      location: typeof r.location === 'string' ? r.location : null,
    })
  }
  return reservations
}

/** What a reservation took, as lines to give back if the write that needed it fails. */
export function reservedLines(reservations: ReadonlyMap<string, Reservation>): StockLine[] {
  return [...reservations]
    .filter(([, r]) => r.reserved > 0)
    .map(([model_code, r]) => ({ model_code, quantity: r.reserved }))
}

/** Adds stock back, creating the row when it is missing; returns how many codes it touched. */
export async function releaseInventory(db: SupabaseClient, lines: StockLine[]): Promise<number> {
  if (lines.length === 0) return 0
  const { data, error } = await db.rpc('release_inventory', { p_lines: lines })
  if (error) throw new Error(`release_inventory: ${error.message}`)
  return toInt(data)
}

export interface StockAdjustment {
  /** Stock after the move; null when nothing moved. */
  quantity: number | null
  /** A negative delta hit 0: part of it could not be subtracted. */
  clamped: boolean
  /** A negative delta found no row to subtract from. */
  missing: boolean
}

/** Reception delta (ADR-019): positive adds (creating the row), negative subtracts clamped at 0. */
export async function adjustInventory(db: SupabaseClient, modelCode: string, delta: number): Promise<StockAdjustment> {
  const none: StockAdjustment = { quantity: null, clamped: false, missing: false }
  if (delta === 0 || !stockKey(modelCode)) return none
  const { data, error } = await db.rpc('adjust_inventory', { p_model_code: modelCode, p_delta: delta })
  if (error) throw new Error(`adjust_inventory: ${error.message}`)
  const r = (data ?? {}) as { quantity?: unknown; clamped?: unknown; missing?: unknown }
  return {
    quantity: r.quantity == null ? null : toInt(r.quantity),
    clamped: r.clamped === true,
    missing: r.missing === true,
  }
}
