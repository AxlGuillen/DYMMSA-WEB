/** Receivable domains shared by the MCP tools and the app's income route (#94, ADR-027). */

import type { DomainTriple } from './catalog'

/** Posted with an outstanding balance — the part invoices and credit notes have in common. */
const OPEN_BALANCE_CONDITIONS: readonly DomainTriple[] = [
  ['state', '=', 'posted'],
  ['payment_state', 'in', ['not_paid', 'partial']],
  ['amount_residual', '>', 0],
]

/** Posted customer invoices with an outstanding balance, due or not. */
export const OPEN_RECEIVABLES_DOMAIN: readonly DomainTriple[] = [
  ['move_type', '=', 'out_invoice'],
  ...OPEN_BALANCE_CONDITIONS,
]

/** Posted customer credit notes not yet applied: customer credit, never a debt (#102). */
export const OPEN_CREDIT_NOTES_DOMAIN: readonly DomainTriple[] = [
  ['move_type', '=', 'out_refund'],
  ...OPEN_BALANCE_CONDITIONS,
]

/** Invoices AND credit notes in one read; the app splits them by move_type (#102). */
export const OPEN_CUSTOMER_MOVES_DOMAIN: readonly DomainTriple[] = [
  ['move_type', 'in', ['out_invoice', 'out_refund']],
  ...OPEN_BALANCE_CONDITIONS,
]

/** Open receivables already past their due date at `today`. */
export const overdueDomain = (today: string): DomainTriple[] => [
  ...OPEN_RECEIVABLES_DOMAIN,
  ['invoice_date_due', '<', today],
]
