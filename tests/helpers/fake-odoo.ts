/** Odoo fakes for the write tools (#144): each one enforces the SAME guard as production. */

import { assertReadCall, serializeWritePayload, type OdooCaller, type OdooRawWriter } from '@/lib/odoo/client'
import { assertWriteAllowed } from '@/lib/odoo/write-catalog'
import { createOdooWriter, type OdooWriter, type WriteLogEntry } from '@/lib/odoo/writer'
import { issueAdminProof, type AdminProof } from '@/lib/auth/admin-proof'
import * as previewTokens from '@/lib/odoo/preview-token'
import * as writeGuard from '@/lib/auth/admin-proof'
import type { PreviewGrant, QuotationKeyKind } from '@/lib/odoo/preview-token'

export type OdooCall = { model: string; method: string; payload: Record<string, unknown> }

/** Responses per `model.method`, consumed in order; an Error instance is thrown instead. */
export type OdooScript = Record<string, unknown[]>

function takeScripted(pending: Record<string, unknown[]>, key: string, fallback?: () => unknown): unknown {
  const queue = pending[key]
  if (!queue || queue.length === 0) {
    if (fallback) return fallback()
    throw new Error(`sin respuesta programada para ${key}`)
  }
  const next = queue.shift()
  if (next instanceof Error) throw next
  return next
}

const copyScript = (script: OdooScript) =>
  Object.fromEntries(Object.entries(script).map(([key, responses]) => [key, [...responses]]))

/** Reader fake: every attempt is recorded, and writes, read or fields_get fail as in production. */
export function fakeOdoo(script: OdooScript = {}) {
  const calls: OdooCall[] = []
  const pending = copyScript(script)
  const odoo: OdooCaller = async (model, method, payload) => {
    calls.push({ model, method, payload })
    assertReadCall(model, method)
    return takeScripted(pending, `${model}.${method}`)
  }
  return { odoo, calls }
}

export type RawWriteCall = OdooCall & { remainingMs: number }

/** Methods whose real result the facade ignores. */
const DEFAULT_WRITE_RESULTS: Readonly<Record<string, unknown>> = {
  'sale.order.write': true,
  'sale.order.action_confirm': true,
  'product.product.write': true,
  'sale.advance.payment.inv.create_invoices': true,
}

/** Transport fake behind the real write catalog: a payload production would refuse is refused here. */
export function fakeRawWriter(script: OdooScript = {}) {
  const calls: RawWriteCall[] = []
  const pending = copyScript(script)
  const raw: OdooRawWriter = async (model, method, payload, dl) => {
    // Same JSON copy production validates and sends: undefined keys and toJSON behave alike.
    const { snapshot } = serializeWritePayload(model, method, payload)
    calls.push({ model, method, payload: snapshot as Record<string, unknown>, remainingMs: dl.remainingMs() })
    assertWriteAllowed(model, method, snapshot)
    const key = `${model}.${method}`
    return takeScripted(pending, key, key in DEFAULT_WRITE_RESULTS ? () => DEFAULT_WRITE_RESULTS[key] : undefined)
  }
  return { raw, calls }
}

export type WriterOperation = keyof OdooWriter
export type WriterCall = { op: WriterOperation; args: unknown[] }

/** The real facade over fakeRawWriter: records both the facade calls and the payloads sent. */
export function fakeWriter(script: OdooScript = {}, opts: { now?: () => number } = {}) {
  const transport = fakeRawWriter(script)
  const ops: WriterCall[] = []
  const logs: WriteLogEntry[] = []
  const real = createOdooWriter(transport.raw, { now: opts.now, log: (entry) => logs.push(entry) })
  const writer = Object.fromEntries(
    (Object.keys(real) as WriterOperation[]).map((op) => [
      op,
      (...args: unknown[]) => {
        ops.push({ op, args })
        return (real[op] as (...a: unknown[]) => Promise<unknown>)(...args)
      },
    ]),
  ) as unknown as OdooWriter
  return { writer, ops, calls: transport.calls, logs }
}

/** For read-only paths: any write attempt throws, and `attempts` must stay empty. */
export function throwingWriter() {
  const attempts: WriterOperation[] = []
  const shape = createOdooWriter(async () => {
    throw new Error('throwingWriter: transporte inalcanzable')
  })
  const writer = Object.fromEntries(
    (Object.keys(shape) as WriterOperation[]).map((op) => [
      op,
      async () => {
        attempts.push(op)
        throw new Error(`throwingWriter: no se debía escribir en Odoo (${op})`)
      },
    ]),
  ) as unknown as OdooWriter
  return { writer, attempts }
}

/**
 * A real, freshly issued proof; tests may call issueAdminProof, src only from shared.ts.
 * One clock (#144): requireLiveAdmin stamps with Date.now(), so tool tests use vi.setSystemTime, never `now`.
 */
export function testAdminProof(overrides: { userId?: string; displayName?: string; now?: number } = {}): AdminProof {
  return issueAdminProof(
    { userId: overrides.userId ?? 'admin-1', displayName: overrides.displayName ?? 'Ana Admin' },
    overrides.now,
  )
}

const GRANT_ENV: Readonly<Record<string, string>> = { ODOO_URL: 'https://odoo.test', ODOO_WRITE_API_KEY: 'grant-key-for-tests-0123' }

/** Synchronous on purpose: the write env is borrowed only while the key is minted and verified. */
function withGrantEnv<T>(fn: () => T): T {
  const saved = Object.keys(GRANT_ENV).map((key) => [key, process.env[key]] as const)
  Object.assign(process.env, GRANT_ENV)
  try {
    return fn()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

export interface TestGrantOptions {
  kind?: QuotationKeyKind
  userId?: string
  partnerId?: number
  /** Defaults to 912 when editing or confirming, null when creating. */
  saleId?: number | null
  now?: number
}

/** A real PreviewGrant through issue → verify → grant; `modules` serves tests that reset the module graph. */
export function testPreviewGrant(
  opts: TestGrantOptions = {},
  modules: { tokens: typeof previewTokens; guard: typeof writeGuard } = { tokens: previewTokens, guard: writeGuard },
): PreviewGrant {
  const kind = opts.kind ?? 'crear'
  const saleId = opts.saleId !== undefined ? opts.saleId : kind === 'crear' ? null : 912
  const now = opts.now ?? Date.now()
  const input = saleId === null ? { cliente: '#1' } : { folio: `S${String(saleId).padStart(5, '0')}` }
  return withGrantEnv(() => {
    const proof = modules.guard.issueAdminProof({ userId: opts.userId ?? 'admin-1', displayName: 'Ana Admin' }, now)
    const target = { kind, input, partnerId: opts.partnerId ?? 1, saleId, writeDate: saleId === null ? null : '2026-10-17 22:47:43' }
    const { clave } = modules.tokens.issueQuotationKey(proof, target, { now })
    const verified = modules.tokens.verifyQuotationKey(proof, clave, { kind, input }, { now })
    return modules.tokens.grantPreviewWrite(verified, { now })
  })
}
