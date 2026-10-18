/**
 * Odoo JSON-2 client (ADR-025): /jsonrpc is dead in Online 21.1; ~1 req/s with NO parallelism →
 * one serialized queue + one retry on 429. The shared caller is read-only by construction; writes
 * go through createOdooRawWriter, with its own key and allowlist, on the SAME queue (#144).
 */

import { writeTimeoutMs, type Deadline } from './deadline'
import { odooEnv, odooWriteEnv, type OdooEnv } from './env'
import { assertWriteAllowed } from './write-catalog'

// env/write-catalog ↔ client cycles are benign on purpose: each side only uses the other inside functions.
export class OdooError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'OdooError'
  }
}

/** Each write retries differently: only quotations carry a preview key (#144, ADR-040). */
export type UncertainRetry = 'quotation' | 'invoice' | 'products'

// An aborted request keeps running in Odoo: a retry right away could miss a create still committing (#144).
const UNCERTAIN_RETRY_WAIT = 'Odoo puede seguir guardando: espera 2 minutos antes de repetir.'

const UNCERTAIN_RETRY_HINT: Readonly<Record<UncertainRetry, string>> = Object.freeze({
  quotation: `${UNCERTAIN_RETRY_WAIT} Repite exactamente la misma llamada (o el mismo clic): con la misma clave no se duplica. No pidas otra vista previa antes de repetirla.`,
  invoice: `${UNCERTAIN_RETRY_WAIT} Repite exactamente la misma llamada con el mismo folio: si el borrador ya se creó, te lo reporto y no creo otro.`,
  products: `${UNCERTAIN_RETRY_WAIT} Repite el mismo clic: los productos que ya se hayan creado salen como existentes y no se duplican.`,
})

/** Odoo may have committed before the failure: never retried, the caller repeats the SAME call (#144). */
export class OdooUncertainWriteError extends OdooError {
  constructor(
    readonly operation: string,
    readonly retry: UncertainRetry,
    status?: number,
  ) {
    super(`No se sabe si Odoo alcanzó a guardar (${operation}). ${UNCERTAIN_RETRY_HINT[retry]}`, status)
    this.name = 'OdooUncertainWriteError'
  }
}

/** Signature the tools receive (injectable in tests, like `Db` in shared.ts). */
export type OdooCaller = (
  model: string,
  method: string,
  payload: Record<string, unknown>,
) => Promise<unknown>

/** Runs tasks one at a time with a minimum spacing between them. */
export type OdooQueue = <T>(task: () => Promise<T>) => Promise<T>

type Sleep = (ms: number) => Promise<void>

const defaultSleep: Sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createOdooQueue(deps: { spacingMs?: number; sleepFn?: Sleep } = {}): OdooQueue {
  const sleep = deps.sleepFn ?? defaultSleep
  const spacingMs = deps.spacingMs ?? 1100
  let chain: Promise<unknown> = Promise.resolve()
  let lastCallAt = 0

  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(async () => {
      const wait = lastCallAt + spacingMs - Date.now()
      if (wait > 0) await sleep(wait)
      try {
        return await task()
      } finally {
        lastCallAt = Date.now()
      }
    })
    // The queue survives errors: the next caller doesn't inherit the failure.
    chain = next.catch(() => undefined)
    return next
  }
}

/** Odoo Online's rate limit counts the whole server: the reader and the writer share it (#144). */
const sharedQueue = createOdooQueue()

export const READ_METHODS = Object.freeze(['search_read', 'read_group', 'search_count'] as const)

// The guard checks a private copy: no import can widen it by mutating the export.
const READ_METHOD_SET: ReadonlySet<string> = new Set(READ_METHODS)

const MODEL_NAME = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/

/** Exported so test fakes enforce the same rule as production (#144). */
export function assertReadCall(model: string, method: string): void {
  if (!READ_METHOD_SET.has(method)) {
    throw new OdooError(`El método "${method}" no es de lectura: este acceso a Odoo es de solo lectura.`)
  }
  // The model goes into the URL path: "sale.order/create?" would smuggle a write past the method check.
  if (!MODEL_NAME.test(model)) {
    throw new OdooError(`"${model}" no es un nombre de modelo de Odoo válido.`)
  }
}

const ODOO_MESSAGE_MAX = 300

/** Only the `message` of a JSON-2 error body; its `debug` is the full server traceback (#144). */
export function parseOdooError(body: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const message = (parsed as { message?: unknown }).message
  if (typeof message !== 'string' || !message.trim()) return null
  const text = message.trim()
  return text.length > ODOO_MESSAGE_MAX ? `${text.slice(0, ODOO_MESSAGE_MAX)}…` : text
}

function httpError(status: number, body: string, op: string): OdooError {
  const message = parseOdooError(body)
  return new OdooError(message ? `Odoo rechazó ${op}: ${message}` : `Odoo respondió ${status} en ${op}.`, status)
}

// Error names are letters only and system codes UPPERCASE: an Odoo key (lowercase hex) matches neither.
const ERROR_NAME = /^[A-Za-z]{1,40}$/
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,40}$/

/** Only fixed identifiers (TypeError, ENOTFOUND…): undici echoes header values (the key) in messages. */
function failureTrace(cause: unknown): { name: string; code: string | null } {
  const name = cause instanceof Error && ERROR_NAME.test(cause.name) ? cause.name : 'unknown'
  let e: unknown = cause
  for (let depth = 0; depth < 3 && e instanceof Error; depth++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && ERROR_CODE.test(code)) return { name, code }
    e = e.cause
  }
  return { name, code: null }
}

/** Above this Retry-After we fail: sleeping would hold the shared queue for every caller (#144). */
const MAX_RETRY_AFTER_S = 5

interface CallerDeps {
  fetchFn?: typeof fetch
  sleepFn?: Sleep
  /** Minimum spacing between calls (default 1100 ms ≈ 1 req/s with margin); ignored with `queue`. */
  spacingMs?: number
  timeoutMs?: number
  getEnv?: () => OdooEnv
  /** Defaults to a private queue; production passes the shared one. */
  queue?: OdooQueue
}

export function createOdooCaller(deps: CallerDeps = {}): OdooCaller {
  // Looked up per call, not at import, so a stubbed global fetch is the one used.
  const fetchFn: (url: string, init: RequestInit) => Promise<Response> =
    deps.fetchFn ?? ((url, init) => fetch(url, init))
  const sleep = deps.sleepFn ?? defaultSleep
  const timeoutMs = deps.timeoutMs ?? 25_000
  const getEnv = deps.getEnv ?? odooEnv
  const queue = deps.queue ?? createOdooQueue({ spacingMs: deps.spacingMs, sleepFn: sleep })

  async function request(
    model: string,
    method: string,
    payload: Record<string, unknown>,
    alreadyRetried: boolean,
  ): Promise<unknown> {
    const { url, apiKey, db } = getEnv()
    const op = `${model}.${method}`
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
      const trace = failureTrace(cause)
      console.error('[odoo] request failed without a response', { op, ...trace })
      const reason = trace.name === 'TimeoutError' ? 'tiempo de espera agotado' : 'error de red'
      throw new OdooError(`No se pudo contactar a Odoo (${op}): ${reason}.`)
    }

    if (res.status === 429 && !alreadyRetried) {
      const header = Number(res.headers.get('retry-after'))
      const waitS = Number.isFinite(header) && header > 0 ? header : 2
      if (waitS > MAX_RETRY_AFTER_S) {
        throw new OdooError(
          `Odoo pidió esperar ${Math.ceil(waitS)} s por su límite de peticiones (${op}): intenta de nuevo en un momento.`,
          429,
        )
      }
      await sleep(waitS * 1000)
      return request(model, method, payload, true)
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw httpError(res.status, body, op)
    }
    return res.json()
  }

  return async (model, method, payload) => {
    // Before the queue: a rejected call never takes a slot nor reaches the network.
    assertReadCall(model, method)
    return queue(() => request(model, method, payload, false))
  }
}

/** Production reader: every tool shares the SAME queue, and it can only read (#144). */
export const callOdoo: OdooCaller = createOdooCaller({ queue: sharedQueue })

/** The writer's transport: validated, on the shared queue, never retried except one 429 (#144, ADR-040). */
export type OdooRawWriter = (
  model: string,
  method: string,
  payload: Record<string, unknown>,
  dl: Deadline,
) => Promise<unknown>

const SLOW_WRITE_MESSAGE = 'Odoo va lento: no escribí nada para no dejarlo a medias. Vuelve a intentarlo.'

const WRITE_KEY_DEAD_MESSAGE =
  'La llave de escritura de Odoo (ODOO_WRITE_API_KEY) ya no sirve: venció o la revocaron. No se escribió nada.'

/** A gateway can't know whether Odoo committed behind it. */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504])

interface RawWriterDeps {
  fetchFn?: (request: Request) => Promise<Response>
  sleepFn?: Sleep
  getEnv?: () => OdooEnv
  /** Defaults to the queue the production reader uses. */
  queue?: OdooQueue
  timeoutSignal?: (ms: number) => AbortSignal
}

export function createOdooRawWriter(deps: RawWriterDeps = {}): OdooRawWriter {
  const fetchFn = deps.fetchFn ?? ((request: Request) => fetch(request))
  const sleep = deps.sleepFn ?? defaultSleep
  const getEnv = deps.getEnv ?? odooWriteEnv
  const queue = deps.queue ?? sharedQueue
  const timeoutSignal = deps.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms))

  async function send(
    env: OdooEnv,
    model: string,
    method: string,
    body: string,
    dl: Deadline,
    retry: UncertainRetry,
    alreadyRetried: boolean,
  ): Promise<unknown> {
    const op = `${model}.${method}`
    // Measured as the call leaves the queue: the wait there must not eat the write's own window.
    const timeoutMs = writeTimeoutMs(dl.remainingMs())
    if (timeoutMs === null) throw new OdooError(SLOW_WRITE_MESSAGE)

    // Built before the uncertain block: a header or URL TypeError means nothing was sent.
    let request: Request
    try {
      request = new Request(`${env.url}/json/2/${model}/${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `bearer ${env.apiKey}`,
          ...(env.db ? { 'X-Odoo-Database': env.db } : {}),
        },
        body,
        signal: timeoutSignal(timeoutMs),
        // A redirect would re-send the write (and its key) wherever Location points.
        redirect: 'manual',
      })
    } catch (cause) {
      console.error('[odoo-write] request could not be built', { op, ...failureTrace(cause) })
      throw new OdooError(
        `No se pudo armar la petición a Odoo (${op}): no se envió nada. Revisa ODOO_URL y ODOO_WRITE_API_KEY en el servidor.`,
      )
    }

    let res: Response
    try {
      res = await fetchFn(request)
    } catch (cause) {
      console.error('[odoo-write] request failed without a response', { op, ...failureTrace(cause) })
      throw new OdooUncertainWriteError(op, retry)
    }

    if (res.status === 429 && !alreadyRetried) {
      const header = Number(res.headers.get('retry-after'))
      const waitS = Number.isFinite(header) && header > 0 ? header : 2
      if (waitS > MAX_RETRY_AFTER_S) {
        throw new OdooError(
          `Odoo pidió esperar ${Math.ceil(waitS)} s por su límite de peticiones (${op}): no se escribió nada, intenta de nuevo en un momento.`,
          429,
        )
      }
      await sleep(waitS * 1000)
      return send(env, model, method, body, dl, retry, true)
    }

    if (res.status === 401) throw new OdooError(WRITE_KEY_DEAD_MESSAGE, 401)

    // Status 0 is an opaque redirect: either way Odoo never processed the write at this URL.
    if (res.status === 0 || (res.status >= 300 && res.status < 400)) {
      throw new OdooError(
        `Odoo respondió con una redirección (${res.status}) en ${op}: no se escribió nada. Revisa que ODOO_URL sea el origen exacto.`,
        res.status,
      )
    }

    if (!res.ok) {
      const message = parseOdooError(await res.text().catch(() => ''))
      // A JSON-2 error body means Odoo rolled the call back; anything else past 500 is unknown.
      if (GATEWAY_STATUSES.has(res.status) || (res.status >= 500 && message === null)) {
        console.error('[odoo-write] uncertain response', { op, status: res.status })
        throw new OdooUncertainWriteError(op, retry, res.status)
      }
      throw new OdooError(
        message ? `Odoo rechazó ${op}: ${message}` : `Odoo respondió ${res.status} en ${op}.`,
        res.status,
      )
    }

    try {
      return await res.json()
    } catch (cause) {
      console.error('[odoo-write] unreadable success body', { op, status: res.status, ...failureTrace(cause) })
      throw new OdooUncertainWriteError(op, retry, res.status)
    }
  }

  return async (model, method, payload, dl) => {
    const { body, snapshot } = serializeWritePayload(model, method, payload)
    // Validates exactly the bytes that will be sent, before the queue: a refusal takes no slot.
    const { retry } = assertWriteAllowed(model, method, snapshot)
    const env = getEnv()
    return queue(() => send(env, model, method, body, dl, retry, false))
  }
}

/** The body as sent and its parsed copy: toJSON or undefined keys can't differ from what is checked. */
export function serializeWritePayload(
  model: string,
  method: string,
  payload: unknown,
): { body: string; snapshot: unknown } {
  try {
    const body = JSON.stringify(payload)
    return { body, snapshot: JSON.parse(body) }
  } catch {
    throw new OdooError(`La escritura ${model}.${method} no se puede serializar: no se envió nada.`)
  }
}
