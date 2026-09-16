import type { QuotationStatus } from '@/types/database'

/** Single source for the badge and the status dropdown. */
export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: 'Borrador',
  sent_for_approval: 'En aprobación',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  converted_to_order: 'Convertida',
}

/** `converted_to_order` is excluded: it is only set by generating the order. */
export const MANUAL_QUOTATION_STATUSES: QuotationStatus[] = [
  'draft',
  'sent_for_approval',
  'approved',
  'rejected',
]
