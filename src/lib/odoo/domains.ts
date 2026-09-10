/** Receivable domains shared by the MCP tools and the app's income route (#94, ADR-027). */

import type { DomainTriple } from './catalog'

/** Posted customer invoices with an outstanding balance, due or not. */
export const OPEN_RECEIVABLES_DOMAIN: readonly DomainTriple[] = [
  ['move_type', '=', 'out_invoice'],
  ['state', '=', 'posted'],
  ['payment_state', 'in', ['not_paid', 'partial']],
  ['amount_residual', '>', 0],
]

/** Open receivables already past their due date at `today`. */
export const overdueDomain = (today: string): DomainTriple[] => [
  ...OPEN_RECEIVABLES_DOMAIN,
  ['invoice_date_due', '<', today],
]
