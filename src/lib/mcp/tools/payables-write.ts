/**
 * save_payable (#155 C6, ADR-041): one entity, one tool — register, correct, pay, send back to pending and cancel.
 * The rules live in payables.ts and payables-store.ts, shared with the routes; the audit trigger attributes every
 * write to the token's user, so nothing here touches audit_events (ADR-028).
 */

import type { WritePlan } from '@/lib/mcp/core/define'
import { diff, writeResult } from '@/lib/mcp/core/envelope'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import { todayInMexico } from '@/lib/format'
import {
  dueDateFrom,
  parsePayableUpdate,
  PAYABLE_STATUS_TOKENS,
  paymentTermsLabel,
  resolvePaymentUpdate,
  DEFAULT_PAYABLE_CURRENCY,
  type ISODate,
} from '@/lib/payables'
import { createPayable, updatePayable } from '@/lib/payables-store'
import type { PayableCurrency, PayableStatus, PayableUpdate, PayableWithSupplier } from '@/types/database'
import { digest, resolvePayable } from './payables'
import { resolveSupplier, type SupplierRef } from './suppliers'

export interface SavePayableInput {
  /** Ref, or part of the concept / supplier name; absent = a new invoice. */
  factura?: string
  proveedor?: string
  concepto?: string
  monto?: number
  moneda?: PayableCurrency
  fecha_factura?: string
  vencimiento?: string
  notas?: string
  /** pendiente | pagada | cancelada (PAYABLE_STATUS_TOKENS). */
  estado?: string
  /** Real payment date; with `estado: pagada` or alone to correct it on a paid one. */
  fecha_pago?: string
}

type Carry =
  | { kind: 'create'; body: Record<string, unknown>; paidAt: string | null; supplier: SupplierRef; dueCalculated: boolean; today: ISODate }
  | { kind: 'update'; target: PayableWithSupplier; body: Record<string, unknown>; updates: PayableUpdate; today: ISODate; dueKept: boolean }

const FIELD_NAMES: Record<string, string> = { invoice_date: 'fecha_factura', due_date: 'vencimiento' }

/** Changing any of these on a PAID invoice moves what was paid in its month: that one asks for the yes (plan §3). */
const PAID_FIGURES = ['monto', 'moneda', 'proveedor', 'fecha_factura', 'vencimiento', 'pagada_el'] as const

const PAID_WARNING = 'Es una factura pagada: corregir sus cifras cambia lo pagado de su mes en el cierre.'

function statusOf(input: SavePayableInput): PayableStatus | undefined {
  if (input.estado === undefined) return undefined
  const status = PAYABLE_STATUS_TOKENS.toDb(input.estado)
  if (!status) throw new ToolError(`Estado inválido "${input.estado}": usa ${PAYABLE_STATUS_TOKENS.tokens.join(' | ')}`)
  return status
}

/** What the assistant may do with an existing invoice (ADR-037): the rest stays in the app. */
function assertTransition(target: PayableWithSupplier, status: PayableStatus | undefined, input: SavePayableInput): void {
  const name = `"${target.concept}"`
  if (status === 'cancelled') {
    if (target.status === 'cancelled') throw new ToolError(`${name} ya está cancelada.`)
    // Cancelling clears paid_at: losing the real payment date takes a deliberate step back to pending first.
    if (target.status === 'paid') {
      throw new ToolError(`${name} está pagada (el ${target.paid_at}); para cancelarla primero regrésala a pendiente (estado: pendiente).`)
    }
  }
  if (status === 'paid') {
    if (target.status === 'cancelled') throw new ToolError(`${name} está cancelada; reactívala desde la app.`)
    // A bare "paid" again would re-stamp today's date over the real one (#100).
    if (target.status === 'paid' && !input.fecha_pago) {
      throw new ToolError(`${name} ya estaba pagada el ${target.paid_at}; si quieres corregir la fecha indícala en fecha_pago.`)
    }
  }
  if (status === 'pending') {
    if (target.status === 'pending') throw new ToolError(`${name} ya está pendiente.`)
    if (target.status === 'cancelled') throw new ToolError(`${name} está cancelada; reactívala desde la app.`)
  }
  if (status === undefined && input.fecha_pago !== undefined && target.status !== 'paid') {
    throw new ToolError(`${name} no está pagada: para registrar el pago usa estado: pagada.`)
  }
}

async function planCreate(db: Db, input: SavePayableInput, today: ISODate): Promise<WritePlan<Carry>> {
  const missing = (['proveedor', 'concepto', 'monto', 'fecha_factura'] as const).filter((key) => input[key] === undefined || input[key] === '')
  if (missing.length > 0) {
    throw new ToolError(`Para registrar una factura nueva faltan: ${missing.join(', ')}. Para corregir una existente indica \`factura\`.`)
  }
  const status = statusOf(input)
  if (status === 'cancelled') throw new ToolError('Una factura nueva no nace cancelada: regístrala pendiente o pagada.')
  if (input.fecha_pago !== undefined && status !== 'paid') throw new ToolError('fecha_pago solo va con estado: pagada.')
  let paidAt: string | null = null
  if (status === 'paid') {
    const payment = resolvePaymentUpdate('paid', input.fecha_pago, today)
    if (!payment.ok) throw new ToolError(payment.error)
    paidAt = payment.updates.paid_at
  }

  const supplier = await resolveSupplier(db, input.proveedor as string)
  const dueDate = input.vencimiento ?? dueDateFrom(input.fecha_factura as string, supplier.payment_terms_days)
  const body = {
    supplier_id: supplier.id,
    concept: input.concepto,
    amount: input.monto,
    currency: input.moneda,
    invoice_date: input.fecha_factura,
    due_date: dueDate,
    notes: input.notas,
  }
  return {
    entity: {
      key: 'factura',
      value: {
        proveedor: supplier.name,
        concepto: String(input.concepto).trim(),
        monto: input.monto,
        moneda: input.moneda ?? DEFAULT_PAYABLE_CURRENCY,
        fecha_factura: input.fecha_factura,
        vencimiento: dueDate,
        estado: paidAt ? 'pagada' : 'pendiente',
        pagada_el: paidAt,
      },
    },
    // Registering never overwrites anything: it writes at once.
    directo: true,
    fingerprint: null,
    subject: 'La factura nueva',
    carry: { kind: 'create', body, paidAt, supplier, dueCalculated: input.vencimiento === undefined, today },
  }
}

async function planUpdate(db: Db, input: SavePayableInput, today: ISODate): Promise<WritePlan<Carry>> {
  const status = statusOf(input)
  // The state asked for decides which of several matches is meant: «ya pagué la de Perfiles» is the pending one.
  const prefer: PayableStatus | undefined = status === 'cancelled' || status === 'paid' ? 'pending' : status === 'pending' ? 'paid' : undefined
  const target = await resolvePayable(db, input.factura as string, prefer)
  assertTransition(target, status, input)
  const supplier = input.proveedor !== undefined ? await resolveSupplier(db, input.proveedor) : null

  const fields: Record<string, unknown> = {
    concept: input.concepto,
    amount: input.monto,
    currency: input.moneda,
    invoice_date: input.fecha_factura,
    due_date: input.vencimiento,
    supplier_id: supplier?.id,
    notes: input.notas,
    status,
    paid_at: input.fecha_pago,
  }
  const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
  const parsed = parsePayableUpdate(body, today, target.status)
  if (!parsed.ok) throw new ToolError(parsed.error.replace(/invoice_date|due_date/, (f) => FIELD_NAMES[f]))
  if (Object.keys(parsed.updates).length === 0) {
    throw new ToolError('No hay cambios: indica qué corregir (concepto, monto, moneda, fechas, proveedor, notas, estado o fecha_pago).')
  }

  const projected = { ...target, ...parsed.updates, supplier: supplier ?? target.supplier } as PayableWithSupplier
  const cambios = diff(digest(target, today), digest(projected, today), ['ref', 'dias_para_vencer'])
  // The same values again change nothing: say so instead of writing a no-op.
  if (Object.keys(cambios).length === 0) throw new ToolError('No hay cambios: esos valores ya son los de la factura.')
  const finalStatus = parsed.updates.status ?? target.status
  const sensitive = target.status === 'paid' && finalStatus === 'paid' && PAID_FIGURES.some((key) => key in cambios)
  return {
    entity: { key: 'factura', value: digest(projected, today) },
    cambios,
    avisos: sensitive ? [PAID_WARNING] : undefined,
    directo: !sensitive,
    fingerprint: { id: target.id, updated_at: target.updated_at, status: target.status, amount: target.amount, currency: target.currency, due_date: target.due_date, paid_at: target.paid_at },
    subject: `La factura «${target.concept}»`,
    carry: { kind: 'update', target, body, updates: parsed.updates, today, dueKept: input.fecha_factura !== undefined && input.vencimiento === undefined },
  }
}

export function planSavePayable(db: Db, input: SavePayableInput, today: ISODate = todayInMexico()): Promise<WritePlan<Carry>> {
  return input.factura?.trim() ? planUpdate(db, input, today) : planCreate(db, input, today)
}

/** Writes what the plan decided. A new invoice that is paid is registered pending and then paid, as the app does. */
export async function commitSavePayable(db: Db, plan: WritePlan<Carry>) {
  const carry = plan.carry
  if (carry.kind === 'create') {
    let row = await createPayable(db, carry.body)
    if (carry.paidAt) row = await updatePayable(db, row.id, { status: 'paid', paid_at: carry.paidAt }, carry.today)
    const calculated = `Registrada como pendiente; vencimiento calculado con el plazo del proveedor (${paymentTermsLabel(carry.supplier.payment_terms_days)}).`
    return writeResult('creado', 'factura', digest(row, carry.today), {
      nota: carry.paidAt ? `Registrada y marcada como pagada el ${carry.paidAt}.` : carry.dueCalculated ? calculated : 'Registrada como pendiente.',
    })
  }
  const { target, body, updates, today, dueKept } = carry
  const row = await updatePayable(db, target.id, body, today)
  const after = digest(row, today)
  return writeResult('actualizado', 'factura', after, {
    cambios: diff(digest(target, today), after, ['ref', 'dias_para_vencer']),
    // No mention of the audit trail: a member can run this and must not learn it exists (ADR-028).
    nota:
      updates.status === 'cancelled'
        ? 'Cancelada: ya no cuenta en pendientes ni en el cierre del mes.'
        : updates.status === 'paid'
          ? `Marcada como pagada el ${row.paid_at}.`
          : updates.status === 'pending'
            ? 'Regresada a pendiente.'
            : dueKept
              ? `Corregida. El vencimiento sigue en ${after.vencimiento}; si también cambia, indícalo en vencimiento.`
              : 'Corregida.',
  })
}
