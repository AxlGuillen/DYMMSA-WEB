import type { QuotationStatus } from '@/types/database'

/** Etiquetas en español de cada estado de cotización. Fuente única para badge + dropdown. */
export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: 'Borrador',
  sent_for_approval: 'En aprobación',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  converted_to_order: 'Convertida',
}

/**
 * Estados que el usuario puede asignar manualmente desde el dropdown.
 * `converted_to_order` se excluye: solo se asigna al generar la orden.
 */
export const MANUAL_QUOTATION_STATUSES: QuotationStatus[] = [
  'draft',
  'sent_for_approval',
  'approved',
  'rejected',
]
