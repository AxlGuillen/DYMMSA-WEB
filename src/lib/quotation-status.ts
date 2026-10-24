import type { QuotationStatus } from '@/types/database'
import { tokenMap } from '@/lib/tokens'

/** The assistant's tokens (#155 C6, ADR-041 §7): the same in the filters and in the answers. */
export const QUOTATION_STATUS_TOKENS = tokenMap({
  draft: 'borrador',
  sent_for_approval: 'en_revision',
  approved: 'aprobada',
  rejected: 'rechazada',
  converted_to_order: 'convertida',
} as const satisfies Record<QuotationStatus, string>)

/** Single source for the badge and the status dropdown. */
export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: 'Borrador',
  sent_for_approval: 'En aprobación',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  converted_to_order: 'Convertida',
}

/** Every status, in the order of the flow (the MCP's enum, #155 C1). */
export const QUOTATION_STATUSES = [
  'draft',
  'sent_for_approval',
  'approved',
  'rejected',
  'converted_to_order',
] as const satisfies readonly QuotationStatus[]

/** `converted_to_order` is excluded: it is only set by generating the order. */
export const MANUAL_QUOTATION_STATUSES: QuotationStatus[] = [
  'draft',
  'sent_for_approval',
  'approved',
  'rejected',
]
