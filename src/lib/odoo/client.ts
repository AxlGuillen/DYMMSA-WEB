/**
 * Cliente JSON-2 de Odoo (issue #65, ADR-025).
 *
 * Transporte sobre la External JSON-2 API (`POST /json/2/<model>/<method>`,
 * `Authorization: bearer <api-key>`) — la sucesora oficial: /jsonrpc y /xmlrpc
 * desaparecen en Odoo Online 21.1 (invierno 2027), por eso NO se usan aquí.
 *
 * Odoo Online tolera ~1 llamada/segundo SIN llamadas paralelas (respuesta
 * oficial en su foro); excederse produce 429. De ahí las dos reglas duras de
 * este módulo:
 *   1. Cola serializada: UNA request en vuelo, con espaciado mínimo entre
 *      llamadas — si el LLM dispara varias tools a la vez, aquí se forman.
 *   2. Backoff: ante 429 se espera (Retry-After o 2 s) y se reintenta UNA vez.
 *
 * `createOdooCaller` existe para inyectar fetch/sleep en tests; producción usa
 * el singleton `callOdoo` (la cola solo funciona si todos comparten la misma).
 */

import { odooEnv } from './env'

// Ciclo de módulos env ↔ client: benigno a propósito — ambos lados solo usan
// al otro DENTRO de funciones (nunca al evaluar el módulo).
export class OdooError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'OdooError'
  }
}

/** Firma que reciben las tools (inyectable en tests, como `Db` en shared.ts). */
export type OdooCaller = (
  model: string,
  method: string,
  payload: Record<string, unknown>,
) => Promise<unknown>

interface CallerDeps {
  fetchFn?: typeof fetch
  sleepFn?: (ms: number) => Promise<void>
  /** Espaciado mínimo entre llamadas (default 1100 ms ≈ 1 req/s con margen). */
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
    // La cola sobrevive a los errores: el siguiente en fila no hereda el fallo.
    chain = task.catch(() => undefined)
    return task
  }
}

/** Singleton de producción: todas las tools comparten la MISMA cola. */
export const callOdoo: OdooCaller = createOdooCaller()
