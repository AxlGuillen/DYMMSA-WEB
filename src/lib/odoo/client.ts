/**
 * Odoo JSON-2 client (ADR-025): /jsonrpc is dead in Online 21.1. Online tolerates ~1 req/s
 * with NO parallelism → serialized queue with spacing + one retry on 429.
 */

import { odooEnv } from './env'

// env ↔ client import cycle is benign on purpose: each side only uses the other inside functions.
export class OdooError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'OdooError'
  }
}

/** Signature the tools receive (injectable in tests, like `Db` in shared.ts). */
export type OdooCaller = (
  model: string,
  method: string,
  payload: Record<string, unknown>,
) => Promise<unknown>

interface CallerDeps {
  fetchFn?: typeof fetch
  sleepFn?: (ms: number) => Promise<void>
  /** Minimum spacing between calls (default 1100 ms ≈ 1 req/s with margin). */
  spacingMs?: number
  timeoutMs?: number
  getEnv?: () => { url: string; apiKey: string; db: string | null }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createOdooCaller(deps: CallerDeps = {}): OdooCaller {
  const fetchFn = deps.fetchFn ?? fetch
  const sleep = deps.sleepFn ?? defaultSleep
  const spacingMs = deps.spacingMs ?? 1100
  const timeoutMs = deps.timeoutMs ?? 25_000
  const getEnv = deps.getEnv ?? odooEnv

  let chain: Promise<unknown> = Promise.resolve()
  let lastCallAt = 0

  async function request(
    model: string,
    method: string,
    payload: Record<string, unknown>,
    alreadyRetried: boolean,
  ): Promise<unknown> {
    const { url, apiKey, db } = getEnv()
    let res: Response
    try {
      res = await fetchFn(`${url}/json/2/${model}/${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `bearer ${apiKey}`,
          ...(db ? { 'X-Odoo-Database': db } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (cause) {
      throw new OdooError(
        `No se pudo contactar a Odoo (${model}.${method}): ${cause instanceof Error ? cause.message : 'error de red'}`,
      )
    }

    if (res.status === 429 && !alreadyRetried) {
      const retryAfter = Number(res.headers.get('retry-after'))
      await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2) * 1000)
      return request(model, method, payload, true)
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new OdooError(
        `Odoo respondió ${res.status} en ${model}.${method}${body ? `: ${body.slice(0, 300)}` : ''}`,
        res.status,
      )
    }
    return res.json()
  }

  return (model, method, payload) => {
    const task = chain.then(async () => {
      const wait = lastCallAt + spacingMs - Date.now()
      if (wait > 0) await sleep(wait)
      try {
        return await request(model, method, payload, false)
      } finally {
        lastCallAt = Date.now()
      }
    })
    // The queue survives errors: the next caller doesn't inherit the failure.
    chain = task.catch(() => undefined)
    return task
  }
}

/** Production singleton: every tool shares the SAME queue. */
export const callOdoo: OdooCaller = createOdooCaller()
