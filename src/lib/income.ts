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
  /** The open-moves read filled its limit: receivable/overdue AND credit notes may be short. */
  receivablesTruncated: boolean
  /** Posted credit notes not yet applied: customer credit, NOT subtracted from receivables (#102). */
  creditNotesTotal: number
  creditNotesCount: number
  /** Non-MXN currencies among the month's collections; amounts are NOT converted. */
  collectionCurrencies: string[]
  /** Non-MXN currencies among open invoices due today or later (month-independent). */
  receivableCurrencies: string[]
  /** Non-MXN currencies among overdue open invoices. */
  overdueCurrencies: string[]
  /** Non-MXN currencies among unapplied credit notes. */
  creditNoteCurrencies: string[]
}

export interface MonthClosing {
  collected: number
  paid: number
  /** Payables due inside the month, still pending. */
  pending: number
  /** Payables overdue from EARLIER months, still pending (disjoint from `pending`). */
  carryOver: number
  /** Money that actually moved: collected − paid. */
  real: number
  /** If everything owed gets paid — the month's pending AND the overdue carry-over. */
  projected: number
}

export function summarizeCollections(rows: readonly OdooCollection[]): Pick<IncomeMonthSummary, 'collectedTotal' | 'collectedCount'> {
  return {
    collectedTotal: rows.reduce((sum, r) => sum + r.amount, 0),
    collectedCount: rows.length,
  }
}

export const isCreditNote = (r: Pick<OdooOpenInvoice, 'moveType'>) => r.moveType === 'out_refund'

/**
 * Same `<` as overdueDomain and payables: due today is still "por cobrar". Credit notes are
 * skipped, never subtracted: whether the customer uses them is unknown (#102, decision 2026-09-21).
 */
export function splitReceivables(
  rows: readonly OdooOpenInvoice[],
  today: ISODate,
): Pick<IncomeMonthSummary, 'receivableTotal' | 'receivableCount' | 'overdueTotal' | 'overdueCount' | 'receivableCurrencies' | 'overdueCurrencies'> {
  const out = { receivableTotal: 0, receivableCount: 0, overdueTotal: 0, overdueCount: 0 }
  const dueCurrencies = new Set<string>()
  const overdueCurrencies = new Set<string>()
  for (const r of rows) {
    if (isCreditNote(r)) continue
    const foreign = r.currency && r.currency !== 'MXN' ? r.currency : null
    if (r.dueDate && r.dueDate < today) {
      out.overdueTotal += r.residual
      out.overdueCount += 1
      if (foreign) overdueCurrencies.add(foreign)
    } else {
      out.receivableTotal += r.residual
      out.receivableCount += 1
      if (foreign) dueCurrencies.add(foreign)
    }
  }
  return { ...out, receivableCurrencies: [...dueCurrencies], overdueCurrencies: [...overdueCurrencies] }
}

/** Customer credit sitting in Odoo; reported apart from what customers owe. */
export function summarizeCreditNotes(
  rows: readonly OdooOpenInvoice[],
): Pick<IncomeMonthSummary, 'creditNotesTotal' | 'creditNotesCount' | 'creditNoteCurrencies'> {
  const credits = rows.filter(isCreditNote)
  return {
    creditNotesTotal: credits.reduce((sum, r) => sum + r.residual, 0),
    creditNotesCount: credits.length,
    creditNoteCurrencies: foreignCurrencies(credits),
  }
}

export function summarizeIncome(
  collections: readonly OdooCollection[],
  openMoves: readonly OdooOpenInvoice[],
  today: ISODate,
  truncated: { collections: boolean; receivables: boolean },
): IncomeMonthSummary {
  return {
    ...summarizeCollections(collections),
    ...splitReceivables(openMoves, today),
    ...summarizeCreditNotes(openMoves),
    collectionsTruncated: truncated.collections,
    receivablesTruncated: truncated.receivables,
    collectionCurrencies: foreignCurrencies(collections),
  }
}

/** Negative is a valid answer: it is exactly the month you would rather not close (ADR-027 §6). */
export function monthClosing(input: { collected: number; paid: number; pending: number; carryOver: number }): MonthClosing {
  const real = input.collected - input.paid
  return { ...input, real, projected: real - input.pending - input.carryOver }
}

export interface IncomeOverviewResponse {
  month: string
  today: ISODate
  /** null → Odoo unavailable; the overview still renders payables. */
  income: IncomeMonthSummary | null
  collections: OdooCollection[]
  /** Unapplied credit notes, newest first; the card lists them (#102). */
  creditNotes: OdooOpenInvoice[]
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
    month, today, income: null, collections: [], creditNotes: [], fetchedAt: null,
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
    creditNotes: open.rows.filter(isCreditNote).sort((a, b) => (b.invoiceDate ?? '').localeCompare(a.invoiceDate ?? '')),
    fetchedAt: collections.fetchedAt < open.fetchedAt ? collections.fetchedAt : open.fetchedAt,
  }
}

/** Currencies other than MXN present in the rows; amounts are not converted. */
export function foreignCurrencies(rows: readonly { currency: string | null }[]): string[] {
  return [...new Set(rows.map((r) => r.currency).filter((c): c is string => !!c && c !== 'MXN'))]
}
