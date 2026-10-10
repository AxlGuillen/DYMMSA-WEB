/** Month helpers shared by payables, income and the Odoo loaders — no app-layer imports here. */

/** 'YYYY-MM-DD' (Postgres `date` columns and Odoo `date` fields — no timezone). */
export type ISODate = string

export const ISO_MONTH = /^\d{4}-\d{2}$/

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Shape AND existence: 2026-02-30 matches the regex and Postgres answers 22008 → a 500 (review PR #128). */
export function isRealDate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export const monthOf = (date: ISODate): string => date.slice(0, 7)

/** EXCLUSIVE month boundary: `${month}-31` does not exist in short months (Postgres 22008). */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** `[from, toExclusive)` for 'YYYY-MM' — the one place that spells the month boundary. */
export function monthRange(month: string): { from: ISODate; toExclusive: ISODate } {
  return { from: `${month}-01`, toExclusive: nextMonth(month) }
}

/** Calendar arithmetic on a date-only string, in UTC so no timezone shifts the day. */
export function shiftDays(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
