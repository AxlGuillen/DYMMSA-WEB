/**
 * Income loaders for the Finance overview (#94, ADR-027): the app READS Odoo, never mirrors
 * it. Caller injected like the MCP tools; every query stays inside the catalog boundary.
 */

import type { OdooCaller } from './client'
import { allowedFields, assertDomainAllowed, type DomainTriple } from './catalog'
import { OPEN_CUSTOMER_MOVES_DOMAIN } from './domains'
import { normalizeRecords } from './normalize'
import { monthRange } from '@/lib/month'

/** 500 covers years of DYMMSA volume; `truncated` says when it did not (PR #75). */
export const INCOME_FETCH_LIMIT = 500

/** Customer payment registered in Odoo (`account.payment`, inbound). */
export interface OdooCollection {
  id: number
  folio: string
  customer: string | null
  /** YYYY-MM-DD (Odoo `date`, no time part). */
  date: string
  amount: number
  currency: string | null
  /** in_process = registered, not yet bank-reconciled; paid = reconciled. Both count. */
  state: string
  memo: string | null
}

export type OdooCustomerMoveType = 'out_invoice' | 'out_refund'

/** Posted customer invoice OR credit note with an outstanding balance (#102). */
export interface OdooOpenInvoice {
  id: number
  /** out_refund = credit note: customer credit, reported apart and never subtracted. */
  moveType: OdooCustomerMoveType
  folio: string
  customer: string | null
  invoiceDate: string | null
  dueDate: string | null
  total: number
  /** In the invoice's currency, like `amount` on collections. */
  residual: number
  currency: string | null
  paymentState: string
}

export interface OdooRows<T> {
  rows: T[]
  /** The limit was filled: the totals may be short. */
  truncated: boolean
}

const COLLECTION_FIELDS = ['name', 'partner_id', 'date', 'amount', 'state', 'memo', 'currency_id']
const OPEN_MOVE_FIELDS = [
  'name', 'move_type', 'partner_id', 'invoice_date', 'invoice_date_due', 'amount_total', 'amount_residual', 'payment_state', 'currency_id',
]

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

/** Money that actually came in during `month` (YYYY-MM), by payment date — same criterion as payables.paid_at. */
export async function fetchMonthCollections(odoo: OdooCaller, month: string): Promise<OdooRows<OdooCollection>> {
  const { from, toExclusive } = monthRange(month)
  // inbound alone also matches supplier refunds and internal transfers (review PR #98).
  const domain: DomainTriple[] = [
    ['payment_type', '=', 'inbound'],
    ['partner_type', '=', 'customer'],
    ['state', 'in', ['in_process', 'paid']],
    ['date', '>=', from],
    ['date', '<', toExclusive],
  ]
  assertDomainAllowed('account.payment', domain)
  const records = normalizeRecords(
    await odoo('account.payment', 'search_read', {
      domain,
      fields: allowedFields('account.payment', COLLECTION_FIELDS),
      limit: INCOME_FETCH_LIMIT,
      order: 'date asc',
    }),
  )
  return {
    rows: records.map((r) => ({
      id: num(r.id),
      folio: str(r.name) ?? '',
      customer: str(r.partner_id),
      date: str(r.date) ?? '',
      amount: num(r.amount),
      currency: str(r.currency_id),
      state: str(r.state) ?? '',
      memo: str(r.memo),
    })),
    truncated: records.length >= INCOME_FETCH_LIMIT,
  }
}

/**
 * Every open invoice and credit note in ONE read (the queue makes each call cost 1.1 s);
 * the due/overdue split and the credit-note summary happen in lib/income.ts.
 */
export async function fetchOpenCustomerMoves(odoo: OdooCaller): Promise<OdooRows<OdooOpenInvoice>> {
  const domain = [...OPEN_CUSTOMER_MOVES_DOMAIN]
  assertDomainAllowed('account.move', domain)
  const records = normalizeRecords(
    await odoo('account.move', 'search_read', {
      domain,
      fields: allowedFields('account.move', OPEN_MOVE_FIELDS),
      limit: INCOME_FETCH_LIMIT,
      order: 'invoice_date_due asc',
    }),
  )
  return {
    rows: records.map((r) => ({
      id: num(r.id),
      moveType: r.move_type === 'out_refund' ? 'out_refund' : 'out_invoice',
      folio: str(r.name) ?? '',
      customer: str(r.partner_id),
      invoiceDate: str(r.invoice_date),
      dueDate: str(r.invoice_date_due),
      // Unsigned in Odoo 17+, also on refunds; abs guards a signed instance from netting by accident.
      total: Math.abs(num(r.amount_total)),
      residual: Math.abs(num(r.amount_residual)),
      currency: str(r.currency_id),
      paymentState: str(r.payment_state) ?? '',
    })),
    truncated: records.length >= INCOME_FETCH_LIMIT,
  }
}
