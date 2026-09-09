/** Income math (#94). Pure like payables.ts: the clock is injected, nothing reads `new Date()`. */

import type { OdooCollection, OdooOpenInvoice } from '@/lib/odoo/income'
import type { ISODate } from '@/lib/month'

export type IncomeUnavailableReason = 'not_configured' | 'odoo_error'

export interface IncomeMonthSummary {
  /** Customer payments dated inside the month. */
  collectedTotal: number
  collectedCount: number
  /** Open invoices due today or later (or without a due date). */
  receivableTotal: number
  receivableCount: number
  /** Open invoices due before today, any month. */
  overdueTotal: number
  overdueCount: number
  /** The payments read filled its limit: collected may be short. */
  collectionsTruncated: boolean
  /** The open-invoices read filled its limit: receivable/overdue may be short. */
  receivablesTruncated: boolean
  /** Non-MXN currencies among the month's collections; amounts are NOT converted. */
  collectionCurrencies: string[]
  /** Non-MXN currencies among open invoices (month-independent, so kept apart). */
  receivableCurrencies: string[]
}

export interface MonthClosing {
  collected: number
  paid: number
  pending: number
  /** Money that actually moved: collected − paid. */
  real: number
  /** If every pending payable of the month gets paid: real − pending. */
  projected: number
}

export function summarizeCollections(rows: readonly OdooCollection[]): Pick<IncomeMonthSummary, 'collectedTotal' | 'collectedCount'> {
  return {
    collectedTotal: rows.reduce((sum, r) => sum + r.amount, 0),
    collectedCount: rows.length,
  }
}

/** Same `<` as overdueDomain and payables: due today is still "por cobrar". */
export function splitReceivables(
  rows: readonly OdooOpenInvoice[],
  today: ISODate,
): Pick<IncomeMonthSummary, 'receivableTotal' | 'receivableCount' | 'overdueTotal' | 'overdueCount'> {
  const out = { receivableTotal: 0, receivableCount: 0, overdueTotal: 0, overdueCount: 0 }
  for (const r of rows) {
    if (r.dueDate && r.dueDate < today) {
      out.overdueTotal += r.residual
      out.overdueCount += 1
    } else {
      out.receivableTotal += r.residual
      out.receivableCount += 1
    }
  }
  return out
}

export function summarizeIncome(
  collections: readonly OdooCollection[],
  openInvoices: readonly OdooOpenInvoice[],
  today: ISODate,
  truncated: { collections: boolean; receivables: boolean },
): IncomeMonthSummary {
  return {
    ...summarizeCollections(collections),
    ...splitReceivables(openInvoices, today),
    collectionsTruncated: truncated.collections,
    receivablesTruncated: truncated.receivables,
    collectionCurrencies: foreignCurrencies(collections),
    receivableCurrencies: foreignCurrencies(openInvoices),
  }
}

/** Negative is a valid answer: it is exactly the month you would rather not close. */
export function monthClosing(input: { collected: number; paid: number; pending: number }): MonthClosing {
  const real = input.collected - input.paid
  return { ...input, real, projected: real - input.pending }
}

export interface IncomeOverviewResponse {
  month: string
  today: ISODate
  /** null → Odoo unavailable; the overview still renders payables. */
  income: IncomeMonthSummary | null
  collections: OdooCollection[]
  /** Oldest of the cached reads; null when unavailable. */
  fetchedAt: string | null
  unavailable?: { reason: IncomeUnavailableReason; message: string }
}

export const INCOME_UNAVAILABLE_MESSAGES: Record<IncomeUnavailableReason, string> = {
  not_configured: 'Odoo no está configurado en este servidor.',
  odoo_error: 'No se pudo leer Odoo; se muestran solo los egresos.',
}

export function incomeUnavailable(month: string, today: ISODate, reason: IncomeUnavailableReason): IncomeOverviewResponse {
  return {
    month, today, income: null, collections: [], fetchedAt: null,
    unavailable: { reason, message: INCOME_UNAVAILABLE_MESSAGES[reason] },
  }
}

export function buildIncomeOverview(
  month: string,
  today: ISODate,
  collections: { rows: OdooCollection[]; truncated: boolean; fetchedAt: string },
  open: { rows: OdooOpenInvoice[]; truncated: boolean; fetchedAt: string },
): IncomeOverviewResponse {
  return {
    month,
    today,
    income: summarizeIncome(collections.rows, open.rows, today, { collections: collections.truncated, receivables: open.truncated }),
    collections: collections.rows,
    fetchedAt: collections.fetchedAt < open.fetchedAt ? collections.fetchedAt : open.fetchedAt,
  }
}

/** Currencies other than MXN present in the rows; amounts are not converted. */
export function foreignCurrencies(rows: readonly { currency: string | null }[]): string[] {
  return [...new Set(rows.map((r) => r.currency).filter((c): c is string => !!c && c !== 'MXN'))]
}
