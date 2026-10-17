/**
 * Customers and their account statement (#145, ADR-039). Pure like income.ts: the clock is injected,
 * nothing reads `new Date()`. One source for the Clientes screens, their export and the MCP.
 */

import type { OdooCustomer, OdooPayment, OdooSale } from '@/lib/odoo/customers'
import type { OdooOpenInvoice } from '@/lib/odoo/income'
import { foreignCurrencies } from '@/lib/income'
import { isRealDate, nextMonth, shiftDays, type ISODate } from '@/lib/month'
import { daysUntilDue } from '@/lib/payables'

export const STATEMENT_FILTERS = ['all', 'overdue', 'upcoming'] as const
export type StatementFilter = (typeof STATEMENT_FILTERS)[number]

export const STATEMENT_FILTER_LABELS: Record<StatementFilter, string> = {
  all: 'Vencidas y por vencer',
  overdue: 'Solo vencidas',
  upcoming: 'Solo por vencer',
}

/** Window on the DUE date; a null bound is open (null `from` = every overdue invoice, however old). */
export interface StatementRange {
  from: ISODate | null
  to: ISODate | null
  filter: StatementFilter
}

/** Everything overdue plus what falls due this month (decision 2026-10-15). */
export function defaultStatementRange(today: ISODate): StatementRange {
  return { from: null, to: shiftDays(nextMonth(today.slice(0, 7)), -1), filter: 'all' }
}

export type RangeResult = { ok: true; range: StatementRange } | { ok: false; error: string }

/** Query params → range. An absent param takes the default; an empty one opens that bound (the inputs send both). */
export function parseStatementRange(params: URLSearchParams, today: ISODate): RangeResult {
  const fallback = defaultStatementRange(today)
  const bound = (key: 'from' | 'to'): ISODate | null | undefined => {
    const raw = params.get(key)
    if (raw === null) return fallback[key]
    if (raw === '') return null
    // Shape AND existence: 2026-02-30 passes a regex (review PR #128).
    return isRealDate(raw) ? raw : undefined
  }
  const from = bound('from')
  const to = bound('to')
  if (from === undefined || to === undefined) return { ok: false, error: 'Fecha inválida — usa YYYY-MM-DD' }
  if (from && to && from > to) return { ok: false, error: 'La fecha "desde" no puede ser posterior a "hasta"' }
  const filter = params.get('filter') ?? 'all'
  if (!(STATEMENT_FILTERS as readonly string[]).includes(filter)) return { ok: false, error: 'Filtro inválido' }
  return { ok: true, range: { from, to, filter: filter as StatementFilter } }
}

/** The query string the pages, the links between them and the hooks share. */
export function rangeQuery(range: StatementRange): string {
  return new URLSearchParams({ from: range.from ?? '', to: range.to ?? '', filter: range.filter }).toString()
}

export type StatementStatus = 'overdue' | 'upcoming'

export interface StatementLine {
  id: number
  folio: string
  invoiceDate: ISODate | null
  dueDate: ISODate | null
  total: number
  /** What is still owed, after partial payments, in the invoice's own currency. */
  residual: number
  currency: string | null
  status: StatementStatus
  /** Days past due (overdue) or left until due (upcoming); null without a due date. */
  days: number | null
}

export interface StatementTotals {
  overdue: number
  overdueCount: number
  upcoming: number
  upcomingCount: number
  total: number
  count: number
}

/** Sums of MXN amounts pick up float noise; two decimals is the currency. */
const money = (v: number) => Math.round(v * 100) / 100

/** Same `<` as overdueDomain and splitReceivables: due today is still "por vencer". */
const statusOf = (dueDate: ISODate | null, today: ISODate): StatementStatus =>
  dueDate && dueDate < today ? 'overdue' : 'upcoming'

/** By due date; one without it falls back to its invoice date, and one with no date at all is never hidden. */
function inRange(move: OdooOpenInvoice, range: StatementRange): boolean {
  const date = move.dueDate ?? move.invoiceDate
  if (!date) return true
  return (range.from === null || date >= range.from) && (range.to === null || date <= range.to)
}

function toLine(move: OdooOpenInvoice, today: ISODate): StatementLine {
  return {
    id: move.id,
    folio: move.folio,
    invoiceDate: move.invoiceDate,
    dueDate: move.dueDate,
    total: move.total,
    residual: move.residual,
    currency: move.currency,
    status: statusOf(move.dueDate, today),
    days: move.dueDate ? Math.abs(daysUntilDue(move.dueDate, today)) : null,
  }
}

/** Undated lines go last: an empty key would put them ahead of the most overdue. */
const sortDate = (l: StatementLine) => l.dueDate ?? l.invoiceDate ?? '9999-12-31'

/** A customer's open invoices in the window, oldest due first. Credit notes never enter (#102). */
export function statementLines(
  moves: readonly OdooOpenInvoice[],
  customerId: number,
  range: StatementRange,
  today: ISODate,
): StatementLine[] {
  return moves
    .filter((m) => m.moveType === 'out_invoice' && m.customerId === customerId && inRange(m, range))
    .map((m) => toLine(m, today))
    .filter((l) => range.filter === 'all' || l.status === range.filter)
    .sort((a, b) => sortDate(a).localeCompare(sortDate(b)) || a.folio.localeCompare(b.folio))
}

/** "vencida hace 12 días" / "vence en 5 días" / "vence hoy": the screen, the print and the Excel say it alike. */
export function daysLabel(line: Pick<StatementLine, 'status' | 'days'>): string {
  if (line.days === null) return 'sin vencimiento'
  if (line.status === 'overdue') return `vencida hace ${line.days} día${line.days === 1 ? '' : 's'}`
  if (line.days === 0) return 'vence hoy'
  return `vence en ${line.days} día${line.days === 1 ? '' : 's'}`
}

/** "Vence hasta el 31/10/2026" / "Vence del … al …" / "Todas las fechas": the window in words. */
export function rangeLabel(range: StatementRange, fmtDay: (iso: string) => string): string {
  if (range.from && range.to) return `Vence del ${fmtDay(range.from)} al ${fmtDay(range.to)}`
  if (range.to) return `Vence hasta el ${fmtDay(range.to)}`
  if (range.from) return `Vence desde el ${fmtDay(range.from)}`
  return 'Todas las fechas de vencimiento'
}

export function statementTotals(lines: readonly StatementLine[]): StatementTotals {
  const out = { overdue: 0, overdueCount: 0, upcoming: 0, upcomingCount: 0 }
  for (const l of lines) {
    if (l.status === 'overdue') {
      out.overdue += l.residual
      out.overdueCount += 1
    } else {
      out.upcoming += l.residual
      out.upcomingCount += 1
    }
  }
  return {
    overdue: money(out.overdue),
    overdueCount: out.overdueCount,
    upcoming: money(out.upcoming),
    upcomingCount: out.upcomingCount,
    total: money(out.overdue + out.upcoming),
    count: lines.length,
  }
}

export interface CreditNoteLine {
  id: number
  folio: string
  date: ISODate | null
  residual: number
  currency: string | null
}

export interface CustomerCreditNotes {
  total: number
  count: number
  lines: CreditNoteLine[]
  /** Non-MXN currencies summed in `total` without conversion (ADR-027 §7). */
  currencies: string[]
}

/** Every unapplied credit note of the customer, with no date window: customer credit, never subtracted (#102). */
export function customerCreditNotes(moves: readonly OdooOpenInvoice[], customerId: number): CustomerCreditNotes {
  const lines = moves
    .filter((m) => m.moveType === 'out_refund' && m.customerId === customerId)
    .map((m) => ({ id: m.id, folio: m.folio, date: m.invoiceDate, residual: m.residual, currency: m.currency }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  return {
    total: money(lines.reduce((sum, l) => sum + l.residual, 0)),
    count: lines.length,
    lines,
    currencies: foreignCurrencies(lines),
  }
}

export interface CustomerRow {
  id: number
  name: string
  city: string | null
  overdue: number
  upcoming: number
  total: number
  openInvoices: number
  creditNotes: number
  creditNoteCount: number
  daysToPay: number | null
  /** Non-MXN currencies in this row's sums: amounts are never converted (ADR-027 §7). */
  currencies: string[]
}

/**
 * One row per customer, biggest balance first. A partner invoiced but not in the customer list still
 * gets its row (with the invoice's name): money is never hidden because a list was incomplete.
 */
export function summarizeCustomers(
  customers: readonly OdooCustomer[],
  moves: readonly OdooOpenInvoice[],
  range: StatementRange,
  today: ISODate,
): CustomerRow[] {
  const known = new Map(customers.map((c) => [c.id, c]))
  const extra = new Map<number, string>()
  for (const m of moves) {
    if (m.customerId !== null && !known.has(m.customerId)) extra.set(m.customerId, m.customer ?? 'Sin nombre')
  }
  const people = [
    ...customers.map((c) => ({ id: c.id, name: c.name, city: c.city, daysToPay: c.daysToPay })),
    ...[...extra].map(([id, name]) => ({ id, name, city: null, daysToPay: null })),
  ]
  return people
    .map((p) => {
      const lines = statementLines(moves, p.id, range, today)
      const totals = statementTotals(lines)
      const credit = customerCreditNotes(moves, p.id)
      return {
        ...p,
        overdue: totals.overdue,
        upcoming: totals.upcoming,
        total: totals.total,
        openInvoices: totals.count,
        creditNotes: credit.total,
        creditNoteCount: credit.count,
        currencies: [...new Set([...foreignCurrencies(lines), ...credit.currencies])],
      }
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es'))
}

export interface CustomersTotals {
  overdue: number
  upcoming: number
  total: number
  openInvoices: number
  creditNotes: number
  currencies: string[]
}

export function customersTotals(rows: readonly CustomerRow[]): CustomersTotals {
  const sum = (pick: (r: CustomerRow) => number) => money(rows.reduce((acc, r) => acc + pick(r), 0))
  return {
    overdue: sum((r) => r.overdue),
    upcoming: sum((r) => r.upcoming),
    total: sum((r) => r.total),
    openInvoices: rows.reduce((acc, r) => acc + r.openInvoices, 0),
    creditNotes: sum((r) => r.creditNotes),
    currencies: [...new Set(rows.flatMap((r) => r.currencies))],
  }
}

export type CustomersUnavailableReason = 'not_configured' | 'odoo_error'

/** GET /api/clients — `customers: null` means Odoo was not readable; the screen says so instead of breaking. */
export interface CustomersResponse {
  today: ISODate
  range: StatementRange
  customers: CustomerRow[] | null
  totals: CustomersTotals | null
  reason: CustomersUnavailableReason | null
  /** A read filled its limit: some customers or invoices may be missing. */
  truncated: boolean
  fetchedAt: string | null
}

export interface CustomerStatement {
  lines: StatementLine[]
  totals: StatementTotals
  currencies: string[]
}

/** Lines + totals + the currencies summed without conversion: one shape for the route and the MCP. */
export function customerStatement(
  moves: readonly OdooOpenInvoice[],
  customerId: number,
  range: StatementRange,
  today: ISODate,
): CustomerStatement {
  const lines = statementLines(moves, customerId, range, today)
  return { lines, totals: statementTotals(lines), currencies: foreignCurrencies(lines) }
}

/** GET /api/clients/[id]. */
export interface CustomerDetailResponse {
  today: ISODate
  range: StatementRange
  customer: OdooCustomer | null
  statement: CustomerStatement | null
  creditNotes: CustomerCreditNotes | null
  sales: OdooSale[] | null
  payments: OdooPayment[] | null
  reason: CustomersUnavailableReason | null
  truncated: boolean
  fetchedAt: string | null
}

export const SALE_STATE_LABELS: Record<string, string> = {
  draft: 'Cotización',
  sent: 'Cotización enviada',
  sale: 'Venta',
  done: 'Cerrada',
  cancel: 'Cancelada',
}

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  invoiced: 'Facturada',
  'to invoice': 'Por facturar',
  no: 'Nada por facturar',
  upselling: 'Oportunidad de venta',
}
