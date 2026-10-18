/** Wall-clock budget of one MCP request, so an Odoo write never outlives the function (#144, ADR-040). */

/** The MCP route's maxDuration (60 s) minus what runs before a tool starts the clock. */
export const REQUEST_BUDGET_MS = 50_000

/** Auth, the live-admin read and a cold start happen before startDeadline() (tested against route.ts). */
export const PRE_TOOL_HEADROOM_MS = 10_000

/** Below this a write is not sent: the function could die with Odoo half-way through it. */
export const MIN_WRITE_WINDOW_MS = 15_000

export const WRITE_TIMEOUT_CAP_MS = 25_000

/** Left after the write's own timeout to report its outcome before the function is killed. */
export const WRITE_TIMEOUT_MARGIN_MS = 5_000

export interface Deadline {
  /** Milliseconds left in the request's budget, never negative. */
  remainingMs(): number
}

export function startDeadline(budgetMs: number = REQUEST_BUDGET_MS, clock: () => number = () => Date.now()): Deadline {
  const endsAt = clock() + budgetMs
  return Object.freeze({ remainingMs: () => Math.max(0, endsAt - clock()) })
}

/** Timeout for a write leaving the queue now: min(25 s, remaining − 5 s), or null when there's no safe window. */
export function writeTimeoutMs(remainingMs: number): number | null {
  if (!(remainingMs >= MIN_WRITE_WINDOW_MS)) return null
  return Math.min(WRITE_TIMEOUT_CAP_MS, remainingMs - WRITE_TIMEOUT_MARGIN_MS)
}
