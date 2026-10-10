/** Payables math (#84). As in format.ts the clock is ALWAYS injected — nothing here reads `new Date()`. */

import type { AuditEvent, Payable, PayableStatus, PayableUpdate } from '@/types/database'
import { isRealDate, monthOf, nextMonth, type ISODate } from './month'

export { monthOf, nextMonth }
export type { ISODate }

export const PAYABLE_STATUSES: readonly PayableStatus[] = ['pending', 'paid', 'cancelled']

export type PaymentUpdate =
  | { ok: true; updates: { status: PayableStatus; paid_at: string | null } }
  | { ok: false; error: string }

/**
 * The payment rule shared by the PATCH route and the MCP write (#109): paid stores the REAL
 * date (today by default), any other status clears it.
 */
export function resolvePaymentUpdate(
  status: unknown,
  paidAt: unknown,
  today: ISODate,
): PaymentUpdate {
  if (!PAYABLE_STATUSES.includes(status as PayableStatus)) return { ok: false, error: 'Estado inválido' }
  if (status !== 'paid') return { ok: true, updates: { status: status as PayableStatus, paid_at: null } }
  if (paidAt !== undefined && paidAt !== null && !isRealDate(paidAt)) {
    return { ok: false, error: 'Fecha de pago inválida' }
  }
  return { ok: true, updates: { status: 'paid', paid_at: (paidAt as string | null | undefined) ?? today } }
}

export type PayableUpdateResult = { ok: true; updates: PayableUpdate } | { ok: false; error: string }

/**
 * The PATCH rules, shared with the MCP's update_payable (#134): sparse, dates that exist
 * (2026-02-30 is a 22008 in Postgres), and status/paid_at through resolvePaymentUpdate.
 * Whether supplier_id exists is the caller's check: it needs the database.
 */
export function parsePayableUpdate(body: unknown, today: ISODate): PayableUpdateResult {
  const raw = (body ?? {}) as Record<string, unknown>
  const updates: PayableUpdate = {}
  if (raw.concept !== undefined) {
    const concept = typeof raw.concept === 'string' ? raw.concept.trim() : ''
    if (!concept) return { ok: false, error: 'El concepto no puede quedar vacío' }
    updates.concept = concept
  }
  if (raw.amount !== undefined) {
    if (typeof raw.amount !== 'number' || !Number.isFinite(raw.amount) || raw.amount <= 0) {
      return { ok: false, error: 'El monto debe ser mayor a 0' }
    }
    updates.amount = raw.amount
  }
  for (const field of ['invoice_date', 'due_date'] as const) {
    if (raw[field] !== undefined) {
      if (!isRealDate(raw[field])) return { ok: false, error: `Fecha inválida en ${field}` }
      updates[field] = raw[field]
    }
  }
  if (raw.supplier_id !== undefined) {
    if (typeof raw.supplier_id !== 'string' || !raw.supplier_id) return { ok: false, error: 'Proveedor inválido' }
    updates.supplier_id = raw.supplier_id
  }
  if (raw.notes !== undefined) {
    updates.notes = typeof raw.notes === 'string' ? raw.notes.trim() || null : null
  }
  if (raw.status !== undefined) {
    const payment = resolvePaymentUpdate(raw.status, raw.paid_at, today)
    if (!payment.ok) return payment
    Object.assign(updates, payment.updates)
  } else if (raw.paid_at !== undefined) {
    // Fix the payment date of an already-paid invoice without touching the status.
    if (raw.paid_at !== null && !isRealDate(raw.paid_at)) return { ok: false, error: 'Fecha de pago inválida' }
    updates.paid_at = raw.paid_at as string | null
  }
  return { ok: true, updates }
}

export const PAYABLE_STATUS_LABELS: Record<PayableStatus, string> = {
  pending: 'Pendiente',
  paid: 'Pagada',
  cancelled: 'Cancelada',
}

/** List filter: the three statuses plus `overdue` (pending with due date before today, as the overview counts it). */
export type PayableFilter = PayableStatus | 'overdue'

export const PAYABLE_FILTER_LABELS: Record<PayableFilter, string> = {
  pending: 'Pendiente',
  overdue: 'Vencida',
  paid: 'Pagada',
  cancelled: 'Cancelada',
}

export function resolvePayableFilter(filter: string, today: ISODate): { status: PayableStatus; dueBefore?: ISODate } | null {
  if (filter === 'overdue') return { status: 'pending', dueBefore: today }
  return PAYABLE_STATUSES.includes(filter as PayableStatus) ? { status: filter as PayableStatus } : null
}

/** Adds the credit days to the invoice date. UTC arithmetic: no DST jumps. */
export function dueDateFrom(invoiceDate: ISODate, termsDays: number | null | undefined): ISODate {
  const days = Number.isInteger(termsDays) && (termsDays as number) > 0 ? (termsDays as number) : 0
  const base = new Date(`${invoiceDate}T00:00:00Z`)
  if (Number.isNaN(base.getTime())) return invoiceDate
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

/** Credit terms DYMMSA uses (#92); anything else goes through "Otro…". */
export const PAYMENT_TERM_PRESETS: readonly { days: number; label: string }[] = [
  { days: 7, label: '1 semana' },
  { days: 15, label: '15 días' },
  { days: 30, label: '1 mes' },
  { days: 60, label: '2 meses' },
  { days: 90, label: '3 meses' },
]

/** 'Contado' | preset label | 'N días'. */
export function paymentTermsLabel(days: number | null | undefined): string {
  // 0 days of credit is cash: the API and the MCP can store it either way.
  if (days == null || days <= 0) return 'Contado'
  return PAYMENT_TERM_PRESETS.find((p) => p.days === days)?.label ?? `${days} días`
}

/** Week of the month (1-based): days 1-7 → 1, 8-14 → 2, capped at 5. */
export function weekOfMonth(date: ISODate): number {
  const day = Number(date.slice(8, 10))
  return Math.min(Math.ceil(day / 7), 5)
}

export interface PayablesWeekBucket {
  /** 1..5 within the month. */
  week: number
  label: string
  total: number
  count: number
}

export interface PayablesMonthSummary {
  /** Pending, due inside the selected month. */
  pendingTotal: number
  pendingCount: number
  /** Pending already overdue at `today`, carry-over from earlier months included. */
  overdueTotal: number
  overdueCount: number
  /** Overdue subset due BEFORE the selected month: never overlaps pendingTotal (#94 closing). */
  carryOverTotal: number
  carryOverCount: number
  /** Pending due within 7 days of `today`, any month. */
  dueSoonTotal: number
  dueSoonCount: number
  /** Paid with `paid_at` inside the selected month. */
  paidTotal: number
  paidCount: number
  /** Month's pending grouped by due week; only non-empty weeks. */
  weeks: PayablesWeekBucket[]
}

/** Month overview; `month` = 'YYYY-MM'. Cancelled payables count for nothing. */
export function summarizeMonth(
  payables: readonly Payable[],
  month: string,
  today: ISODate,
): PayablesMonthSummary {
  const soonLimit = dueDateFrom(today, 7)
  const weekMap = new Map<number, PayablesWeekBucket>()

  const summary: PayablesMonthSummary = {
    pendingTotal: 0, pendingCount: 0,
    overdueTotal: 0, overdueCount: 0,
    carryOverTotal: 0, carryOverCount: 0,
    dueSoonTotal: 0, dueSoonCount: 0,
    paidTotal: 0, paidCount: 0,
    weeks: [],
  }

  for (const p of payables) {
    if (p.status === 'cancelled') continue

    if (p.status === 'paid') {
      if (p.paid_at && monthOf(p.paid_at) === month) {
        summary.paidTotal += p.amount
        summary.paidCount += 1
      }
      continue
    }

    // Overdue at today ALWAYS counts, even when carried from previous months.
    if (p.due_date < today) {
      summary.overdueTotal += p.amount
      summary.overdueCount += 1
      if (monthOf(p.due_date) < month) {
        summary.carryOverTotal += p.amount
        summary.carryOverCount += 1
      }
    } else if (p.due_date <= soonLimit) {
      summary.dueSoonTotal += p.amount
      summary.dueSoonCount += 1
    }

    if (monthOf(p.due_date) === month) {
      summary.pendingTotal += p.amount
      summary.pendingCount += 1
      const week = weekOfMonth(p.due_date)
      const bucket = weekMap.get(week) ?? { week, label: `Semana ${week}`, total: 0, count: 0 }
      bucket.total += p.amount
      bucket.count += 1
      weekMap.set(week, bucket)
    }
  }

  summary.weeks = [...weekMap.values()].sort((a, b) => a.week - b.week)
  return summary
}

/** Days from today to the due date (negative = overdue); drives the cell tone. */
export function daysUntilDue(dueDate: ISODate, today: ISODate): number {
  const due = new Date(`${dueDate}T00:00:00Z`).getTime()
  const now = new Date(`${today}T00:00:00Z`).getTime()
  return Math.round((due - now) / 86_400_000)
}

/** Spanish sentence for one audit row of a payable (ADR-028). `fmtDay` formats a bare ISO date. */
export function describeAuditEvent(
  event: Pick<AuditEvent, 'action' | 'data'>,
  fmtDay: (iso: string) => string,
): string {
  const to = (event.data.to ?? {}) as { status?: PayableStatus; paid_at?: string | null }
  const from = (event.data.from ?? {}) as { paid_at?: string | null }
  switch (event.action) {
    case 'created':
      return 'Registrada'
    case 'deleted':
      return 'Eliminada'
    case 'paid_at_changed':
      return `Fecha de pago corregida: ${from.paid_at ? fmtDay(from.paid_at) : '—'} → ${to.paid_at ? fmtDay(to.paid_at) : '—'}`
    case 'status_changed':
      if (to.status === 'paid') return `Marcada como pagada${to.paid_at ? ` el ${fmtDay(to.paid_at)}` : ''}`
      if (to.status === 'pending') return 'Regresada a pendiente'
      if (to.status === 'cancelled') return 'Cancelada'
      return `Estado: ${to.status ?? '?'}`
  }
}

/**
 * Amount typed in a filter box → number for the API, or '' when it is not a plain amount.
 * Strips es-MX thousands separators and `$`; `parseFloat('1,500')` would silently give 1.
 */
export function parseAmountFilter(raw: string): string {
  const cleaned = raw.replace(/[\s$,]/g, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return ''
  return String(Number(cleaned))
}
