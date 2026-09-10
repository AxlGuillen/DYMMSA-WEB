/** Month helpers shared by payables, income and the Odoo loaders — no app-layer imports here. */

/** 'YYYY-MM-DD' (Postgres `date` columns and Odoo `date` fields — no timezone). */
export type ISODate = string

export const ISO_MONTH = /^\d{4}-\d{2}$/

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
