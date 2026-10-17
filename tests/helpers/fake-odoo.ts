/** Odoo fakes for the write tools (#144): each one enforces the SAME guard as production. */

import { assertReadCall, serializeWritePayload, type OdooCaller, type OdooRawWriter } from '@/lib/odoo/client'
import { assertWriteAllowed } from '@/lib/odoo/write-catalog'
import { createOdooWriter, type OdooWriter, type WriteLogEntry } from '@/lib/odoo/writer'
import { issueAdminProof, type AdminProof } from '@/lib/odoo/write-guard'

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

/** A real, freshly issued proof; tests may call issueAdminProof, src only from shared.ts. */
export function testAdminProof(overrides: { userId?: string; displayName?: string; now?: number } = {}): AdminProof {
  return issueAdminProof(
    { userId: overrides.userId ?? 'admin-1', displayName: overrides.displayName ?? 'Ana Admin' },
    overrides.now,
  )
}
