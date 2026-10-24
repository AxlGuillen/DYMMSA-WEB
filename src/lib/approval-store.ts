/**
 * The client's answer on /approve/[token] (#157): the public route's service-role client only. The MCP never
 * calls this — what DYMMSA records for a client goes through quotations-store.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateQuotationTotal } from '@/lib/business-rules'
import { sendApprovalNotification } from '@/lib/email/send-approval-notification'
import { QuotationError, ruleKey } from '@/lib/quotations-store'
import { isUuid } from '@/lib/text'

export const PROCESSED_MESSAGE = 'Esta cotización ya fue procesada'
export const STALE_ITEMS_CODE = 'stale_items'
export const STALE_ITEMS_MESSAGE =
  'DYMMSA actualizó esta cotización mientras la revisabas y algunos productos ya no están. No se guardó nada: recarga la página y vuelve a marcar tu aprobación.'

export interface ApprovalInput {
  approvedIds: string[]
  finalize: boolean
}

export type ApprovalResult =
  | { saved: true; finalized: false; approvedCount: number }
  | { saved: true; finalized: true; status: 'approved' | 'rejected' }

/** `{ approvedIds?: string[], finalize?: boolean }`; ids must be uuids (the page only sends line ids). */
export function parseApprovalInput(body: unknown): ApprovalInput {
  // A body that is not an object (bad JSON) must not read as "approve nothing" and reset the progress.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new QuotationError('Payload inválido')
  const raw = body as Record<string, unknown>
  const approvedIds = raw.approvedIds ?? []
  if (!Array.isArray(approvedIds) || approvedIds.some((id) => typeof id !== 'string' || !isUuid(id))) {
    throw new QuotationError('Payload inválido')
  }
  if (raw.finalize !== undefined && typeof raw.finalize !== 'boolean') throw new QuotationError('Payload inválido')
  return { approvedIds: [...new Set(approvedIds as string[])], finalize: raw.finalize === true }
}

type QuotationRef = { id: string; status: string; name: string; customer_name: string; total_amount: number }

/** Saves progress or sends, all or nothing (submit_quotation_approval): stale ids → 409 and nothing written. */
export async function submitApproval(db: SupabaseClient, token: string, body: unknown): Promise<ApprovalResult> {
  if (!isUuid(token)) throw new QuotationError('Cotización no encontrada', 'not_found')
  const { data, error: fetchError } = await db
    .from('quotations')
    .select('id, status, name, customer_name, total_amount')
    .eq('approval_token', token)
    .single()
  const quotation = data as QuotationRef | null
  if (!quotation) {
    if (fetchError && fetchError.code !== 'PGRST116') console.error('[approve] read error', fetchError)
    throw new QuotationError('Cotización no encontrada', 'not_found')
  }
  if (quotation.status !== 'sent_for_approval') throw new QuotationError(PROCESSED_MESSAGE)

  const { approvedIds, finalize } = parseApprovalInput(body)

  const { data: result, error } = await db.rpc('submit_quotation_approval', {
    p_token: token,
    p_approved_ids: approvedIds,
    p_finalize: finalize,
  })
  if (error) {
    switch (ruleKey(error)) {
      case 'quotation_not_found':
        throw new QuotationError('Cotización no encontrada', 'not_found')
      case 'quotation_processed':
        // Another request finalized (or DYMMSA moved it) between the read and the lock.
        throw new QuotationError(PROCESSED_MESSAGE, 'conflict')
      case STALE_ITEMS_CODE:
        throw new QuotationError(STALE_ITEMS_MESSAGE, 'conflict', undefined, STALE_ITEMS_CODE)
      default:
        console.error(`[approve] write error quotationId=${quotation.id}`, error)
        throw new QuotationError('Error al guardar las decisiones', 'failed')
    }
  }

  const outcome = (result ?? {}) as { status?: string; approved_count?: number }
  const approvedCount = outcome.approved_count ?? approvedIds.length
  if (!finalize) return { saved: true, finalized: false, approvedCount }

  const status = outcome.status === 'approved' ? 'approved' : 'rejected'
  if (status === 'approved') await notifyApproval(db, quotation, approvedCount)
  return { saved: true, finalized: true, status }
}

/** Isolated: an email failure never reverts the approval (ADR-012). */
async function notifyApproval(db: SupabaseClient, quotation: QuotationRef, approvedCount: number): Promise<void> {
  try {
    // Total of what was ACTUALLY approved: total_amount would over-report a partial approval.
    const { data: approvedItems, error } = await db
      .from('quotation_items')
      .select('unit_price, quantity, item_type, is_approved, is_sold')
      .eq('quotation_id', quotation.id)
      .eq('is_approved', true)
      .limit(5000)
    const hasApprovedItems = !error && approvedItems !== null
    await sendApprovalNotification({
      customerName: quotation.customer_name,
      quotationName: quotation.name,
      total: hasApprovedItems
        ? calculateQuotationTotal(approvedItems, { onlyApproved: true })
        : quotation.total_amount, // fallback if the read fails
      approvedCount: hasApprovedItems ? approvedItems.length : approvedCount,
      quotationId: quotation.id,
    })
  } catch (notifyError) {
    console.warn('Approval notification failed (ignored):', notifyError)
  }
}
