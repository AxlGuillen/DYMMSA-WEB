import { OdooError } from './client'

/** Odoo work a 60 s route may wait for: past this it degrades instead of letting Vercel answer 504 (review PR #150). */
export const ROUTE_ODOO_BUDGET_MS = 45_000

/** Settles with `work`, or rejects with an OdooError once `ms` pass; the caller's OdooError catch then degrades. */
export function withinBudget<T>(work: Promise<T>, ms: number = ROUTE_ODOO_BUDGET_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OdooError(`Odoo no respondió en ${Math.round(ms / 1000)} s.`)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}
