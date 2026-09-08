/** Payables math (#84). As in format.ts the clock is ALWAYS injected — nothing here reads `new Date()`. */

import type { Payable, PayableStatus } from '@/types/database'

export const PAYABLE_STATUS_LABELS: Record<PayableStatus, string> = {
  pending: 'Pendiente',
  paid: 'Pagada',
  cancelled: 'Cancelada',
}

/** 'YYYY-MM-DD' (Postgres `date` columns — no timezone). */
export type ISODate = string

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
  if (days == null) return 'Contado'
  return PAYMENT_TERM_PRESETS.find((p) => p.days === days)?.label ?? `${days} días`
}

export const monthOf = (date: ISODate): string => date.slice(0, 7)

/** EXCLUSIVE month boundary: `${month}-31` does not exist in short months (Postgres 22008). */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
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
