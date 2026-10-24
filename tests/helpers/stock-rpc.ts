/**
 * In-memory stand-in for the atomic stock functions of #157 (reserve/release/adjust_inventory),
 * same semantics as the SQL, so route tests assert the resulting stock instead of payloads.
 * The real functions are covered against the local DB in tests/integration/orders.integration.test.ts.
 */

import type { CallRecord, MockResult } from './supabase-mock'

type Row = { quantity: number; location: string | null }
type Line = { model_code: string; quantity: number }

function consolidate(lines: Line[] | undefined): Array<[string, number]> {
  const byCode = new Map<string, number>()
  for (const line of lines ?? []) {
    if (!line.model_code?.trim()) continue
    byCode.set(line.model_code, (byCode.get(line.model_code) ?? 0) + line.quantity)
  }
  return [...byCode].sort(([a], [b]) => a.localeCompare(b))
}

export function stockRpc(initial: Record<string, number | Row> = {}) {
  const stock = new Map<string, Row>()
  for (const [code, value] of Object.entries(initial)) {
    stock.set(code, typeof value === 'number' ? { quantity: value, location: null } : { ...value })
  }

  /** release_inventory: adds back, creating missing rows; returns codes touched. */
  const release = (lines: Line[] | undefined): number => {
    let touched = 0
    for (const [code, quantity] of consolidate(lines)) {
      if (quantity <= 0) continue
      const row = stock.get(code)
      if (row) row.quantity += quantity
      else stock.set(code, { quantity, location: null })
      touched++
    }
    return touched
  }

  const params = (rec: CallRecord) => (rec.payload ?? {}) as Record<string, unknown>

  const responses: Record<string, (rec: CallRecord) => MockResult> = {
    'rpc.reserve_inventory': (rec) => {
      const result = consolidate(params(rec).p_lines as Line[]).flatMap(([code, asked]) => {
        if (asked <= 0) return []
        const row = stock.get(code)
        if (!row) return [{ model_code: code, reserved: 0, location: null }]
        const taken = Math.min(Math.max(row.quantity, 0), asked)
        row.quantity -= taken
        return [{ model_code: code, reserved: taken, location: row.location }]
      })
      return { data: result, error: null }
    },
    'rpc.release_inventory': (rec) => ({ data: release(params(rec).p_lines as Line[]), error: null }),
    'rpc.adjust_inventory': (rec) => {
      const code = params(rec).p_model_code as string
      const delta = params(rec).p_delta as number
      const row = stock.get(code)
      if (delta > 0) {
        if (row) row.quantity += delta
        else stock.set(code, { quantity: delta, location: null })
        return { data: { quantity: stock.get(code)!.quantity, clamped: false, missing: false }, error: null }
      }
      if (!row) return { data: { quantity: null, clamped: false, missing: true }, error: null }
      const target = row.quantity + delta
      row.quantity = Math.max(0, target)
      return { data: { quantity: row.quantity, clamped: target < 0, missing: false }, error: null }
    },
  }

  return {
    stock,
    responses,
    release,
    /** Current quantity of a code; undefined = no row. */
    quantity: (code: string) => stock.get(code)?.quantity,
  }
}
