/**
 * The cut list of an order, shared by PUT /api/orders/[id]/cut-plan and the MCP's save_cut_plan (#155 D, ADR-022):
 * replace-all with no natural key, so it is delete → insert, restoring the previous list if the insert fails.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DomainError, type DomainErrorKind } from '@/lib/domain-error'
import { parseCutPieces } from '@/lib/cut-plan'
import { explainPgError } from '@/lib/supabase-errors'
import type { CutPlanPiece } from '@/types/database'

export class CutPlanError extends DomainError {
  constructor(message: string, kind: DomainErrorKind = 'invalid') {
    super(message, kind)
    this.name = 'CutPlanError'
  }
}

/** The order's pieces in list order (`sort_order`), numerics still as supabase-js returns them. */
export async function loadCutPieces(db: SupabaseClient, orderId: string): Promise<CutPlanPiece[]> {
  const { data, error } = await db.from('cut_plan_pieces').select('*').eq('order_id', orderId).order('sort_order', { ascending: true })
  if (error) {
    console.error('cut-plan pieces error:', error)
    throw new CutPlanError('Error al cargar la lista de corte', 'failed')
  }
  return (data ?? []) as CutPlanPiece[]
}

/** A piece may only point at a line of THIS order (the FK alone accepts any order's line). */
async function assertSourceItems(db: SupabaseClient, orderId: string, sources: readonly (string | null)[]): Promise<void> {
  const ids = [...new Set(sources.filter((id): id is string => id !== null))]
  if (ids.length === 0) return
  const { data, error } = await db.from('order_items').select('id').eq('order_id', orderId).in('id', ids)
  if (error) throw new CutPlanError('Error al validar la línea de origen', 'failed')
  const own = new Set((data ?? []).map((row) => (row as { id: string }).id))
  const index = sources.findIndex((id) => id !== null && !own.has(id))
  if (index >= 0) throw new CutPlanError(`Pieza ${index + 1}: la línea de origen no es de esta orden`)
}

/** The whole new list; an order completed or cancelled is read-only. Returns the saved pieces. */
export async function saveCutPlan(db: SupabaseClient, orderId: string, pieces: unknown): Promise<CutPlanPiece[]> {
  const { data: order } = await db.from('orders').select('id, status').eq('id', orderId).single()
  if (!order) throw new CutPlanError('Orden no encontrada', 'not_found')
  if (['completed', 'cancelled'].includes(order.status)) throw new CutPlanError('No se puede modificar una orden completada o cancelada')

  const parsed = parseCutPieces(pieces)
  if ('error' in parsed) throw new CutPlanError(parsed.error)
  await assertSourceItems(db, orderId, parsed.value.map((row) => row.source_item_id))
  const rows = parsed.value.map((row) => ({ ...row, order_id: orderId }))

  // Snapshot to restore if the insert fails.
  const { data: previous } = await db.from('cut_plan_pieces').select('*').eq('order_id', orderId)

  const { error: deleteError } = await db.from('cut_plan_pieces').delete().eq('order_id', orderId)
  if (deleteError) {
    console.error('cut-plan delete error:', deleteError)
    throw new CutPlanError('Error al guardar la lista de corte', 'failed')
  }
  if (rows.length === 0) return []

  const { data: saved, error: insertError } = await db.from('cut_plan_pieces').insert(rows).select()
  if (insertError) {
    console.error('cut-plan insert error:', insertError)
    // Restore the previous list: losing it to a save error is not acceptable.
    if (previous && previous.length > 0) {
      const { error: restoreError } = await db.from('cut_plan_pieces').insert(previous.map(({ id: _id, ...row }) => row))
      if (restoreError) console.error('cut-plan restore error:', restoreError)
    }
    // Rule violation (stale FK, shape CHECK) → descriptive 400, not 500 (ADR-009).
    const explanation = explainPgError(insertError)
    if (explanation.isConstraintViolation) throw new CutPlanError(explanation.userMessage)
    throw new CutPlanError('Error al guardar la lista de corte', 'failed')
  }
  return (saved ?? []) as CutPlanPiece[]
}
