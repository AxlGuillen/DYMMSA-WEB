/** Date/range helpers shared by the Odoo tools (review PR #116: one copy instead of four). */

import { ToolError } from '../../shared'

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Both optional; an inverted range is an error, not an empty report the model would read as "all good". */
export function assertDateRange(from?: string, to?: string): void {
  for (const date of [from, to]) {
    if (date && !ISO_DATE.test(date)) throw new ToolError(`Fecha inválida "${date}" — usa YYYY-MM-DD`)
  }
  if (from && to && from > to) {
    throw new ToolError(`Rango invertido: desde ${from} es posterior a hasta ${to}`)
  }
}

export function daysAgo(days: number, today: string): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}
