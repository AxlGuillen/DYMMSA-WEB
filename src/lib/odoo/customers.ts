/**
 * Customer loaders for the Clientes module (#145, ADR-039): the app READS Odoo, never mirrors it.
 * Caller injected like income.ts; every query stays inside the catalog boundary.
 */

import type { OdooCaller } from './client'
import { allowedFields, assertDomainAllowed, type DomainTriple } from './catalog'
import { normalizeRecords } from './normalize'
import type { OdooRows } from './income'
import { todayInMexico } from '@/lib/format'

/** A customer as the app shows it; RFC and contact never leave the screen (no export carries them). */
export interface OdooCustomer {
  id: number
  name: string
  city: string | null
  phone: string | null
  email: string | null
  vat: string | null
  /** Odoo's average days to pay (DSO); computed per record, never filterable (#113). */
  daysToPay: number | null
}

/** Confirmed sale or quotation of the customer. */
export interface OdooSale {
  id: number
  folio: string
  /** Date part of `date_order` (a DATETIME in Odoo). */
  date: string | null
  total: number
  state: string
  invoiceStatus: string | null
}

/** Customer payment registered in Odoo (`account.payment`, inbound). */
export interface OdooPayment {
  id: number
  folio: string
  date: string | null
  amount: number
  currency: string | null
  memo: string | null
}

export interface OdooCustomerActivity {
  sales: OdooSale[]
  payments: OdooPayment[]
}

// 100 per page: days_sales_outstanding is computed against each partner's ledger and the client
// aborts a call at 25 s (review PR #117). 5 pages = 500 customers; `truncated` says when it was not enough.
const PAGE = 100
const MAX_PAGES = 5
/** Recent activity shown on the detail: enough to see the trend, not a ledger. */
export const ACTIVITY_LIMIT = 10

const CUSTOMER_FIELDS = ['name', 'city', 'phone', 'email', 'vat']
const SALE_FIELDS = ['name', 'date_order', 'amount_total', 'state', 'invoice_status']
const PAYMENT_FIELDS = ['name', 'date', 'amount', 'memo', 'currency_id']

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
/** `date_order` is a UTC datetime: an evening sale in Morelia is already tomorrow in UTC. */
const saleDate = (v: string | null) => (v ? todayInMexico(new Date(`${v.replace(' ', 'T')}Z`)) : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Every customer (customer_rank > 0), by name. */
function toCustomer(r: Record<string, unknown>): OdooCustomer {
  const dso = r.days_sales_outstanding
  return {
    id: num(r.id),
    name: str(r.name) ?? 'Sin nombre',
    city: str(r.city),
    phone: str(r.phone),
    email: str(r.email),
    vat: str(r.vat),
    daysToPay: typeof dso === 'number' && Number.isFinite(dso) ? Math.round(dso) : null,
  }
}

const customerFields = () => allowedFields('res.partner', [...CUSTOMER_FIELDS, 'days_sales_outstanding'])

export async function fetchCustomers(odoo: OdooCaller): Promise<OdooRows<OdooCustomer>> {
  const domain: DomainTriple[] = [['customer_rank', '>', 0]]
  assertDomainAllowed('res.partner', domain)
  const fields = customerFields()
  const rows: OdooCustomer[] = []
  let pages = 0
  for (;;) {
    const page = normalizeRecords(
      await odoo('res.partner', 'search_read', { domain, fields, limit: PAGE, offset: pages * PAGE, order: 'name asc, id asc' }),
    )
    pages += 1
    for (const r of page) rows.push(toCustomer(r))
    if (page.length < PAGE) return { rows, truncated: false }
    if (pages >= MAX_PAGES) return { rows, truncated: true }
  }
}

/** One partner by id: the detail must not pay for the whole list on a cold cache (review PR #148). */
export async function fetchCustomer(odoo: OdooCaller, partnerId: number): Promise<OdooCustomer | null> {
  const domain: DomainTriple[] = [['id', '=', partnerId], ['customer_rank', '>', 0]]
  assertDomainAllowed('res.partner', domain)
  const [row] = normalizeRecords(await odoo('res.partner', 'search_read', { domain, fields: customerFields(), limit: 1 }))
  return row ? toCustomer(row) : null
}

/** The customer's latest sales (cancelled ones out) and payments: two reads, newest first. */
export async function fetchCustomerActivity(odoo: OdooCaller, partnerId: number): Promise<OdooCustomerActivity> {
  const saleDomain: DomainTriple[] = [['partner_id', '=', partnerId], ['state', '!=', 'cancel']]
  // inbound alone also matches supplier refunds and internal transfers (review PR #98).
  const paymentDomain: DomainTriple[] = [
    ['partner_id', '=', partnerId],
    ['payment_type', '=', 'inbound'],
    ['partner_type', '=', 'customer'],
    ['state', 'in', ['in_process', 'paid']],
  ]
  assertDomainAllowed('sale.order', saleDomain)
  assertDomainAllowed('account.payment', paymentDomain)

  const sales = normalizeRecords(
    await odoo('sale.order', 'search_read', {
      domain: saleDomain,
      fields: allowedFields('sale.order', SALE_FIELDS),
      limit: ACTIVITY_LIMIT,
      order: 'date_order desc, id desc',
    }),
  )
  const payments = normalizeRecords(
    await odoo('account.payment', 'search_read', {
      domain: paymentDomain,
      fields: allowedFields('account.payment', PAYMENT_FIELDS),
      limit: ACTIVITY_LIMIT,
      order: 'date desc, id desc',
    }),
  )
  return {
    sales: sales.map((r) => ({
      id: num(r.id),
      folio: str(r.name) ?? '',
      date: saleDate(str(r.date_order)),
      total: num(r.amount_total),
      state: str(r.state) ?? '',
      invoiceStatus: str(r.invoice_status),
    })),
    payments: payments.map((r) => ({
      id: num(r.id),
      folio: str(r.name) ?? '',
      date: str(r.date),
      amount: num(r.amount),
      currency: str(r.currency_id),
      memo: str(r.memo),
    })),
  }
}
