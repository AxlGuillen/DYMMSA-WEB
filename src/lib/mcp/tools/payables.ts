/**
 * Payables module (#84/#100): reads + the first writes outside the core (#109, ADR-030).
 * Same rules as the routes through the shared helpers; the audit trigger attributes every
 * write to the token's user, so nothing here touches audit_events.
 */

import { isUuid, requireSingleMatch, sanitizeSearch, ToolError, type Db } from '../shared'
import { resolveSupplier } from './suppliers'
import { todayInMexico } from '@/lib/format'
import { ISO_MONTH, monthRange } from '@/lib/month'
import {
  daysUntilDue,
  describeAuditEvent,
  dueDateFrom,
  ISO_DATE,
  PAYABLE_STATUS_LABELS,
  PAYABLE_STATUSES,
  paymentTermsLabel,
  resolvePaymentUpdate,
  summarizeMonth,
} from '@/lib/payables'
import type { AuditEvent, PayableStatus, PayableWithSupplier } from '@/types/database'

const SELECT = '*, supplier:suppliers(id, name, payment_terms_days)'
// Same caps as /api/payables/overview: a silent cut would lie, so the result says when it hit them.
const OVERVIEW_LIMIT = 1000

function digest(p: PayableWithSupplier, today: string) {
  return {
    id: p.id,
    proveedor: p.supplier?.name ?? null,
    concepto: p.concept,
    monto: p.amount,
    fecha_factura: p.invoice_date,
    vencimiento: p.due_date,
    dias_para_vencer: p.status === 'pending' ? daysUntilDue(p.due_date, today) : null,
    estado: PAYABLE_STATUS_LABELS[p.status],
    pagada_el: p.paid_at,
    notas: p.notes,
  }
}

const label = (p: PayableWithSupplier) =>
  `${p.supplier?.name ?? '?'} · ${p.concept} · $${p.amount} (${PAYABLE_STATUS_LABELS[p.status]})`

async function findPayables(db: Db, search: string, status?: PayableStatus): Promise<PayableWithSupplier[]> {
  // Two steps instead of an embedded filter: "la de Perfiles" names the supplier, not the concept.
  const { data: suppliers } = await db.from('suppliers').select('id').ilike('name', `%${search}%`).limit(20)
  const ids = ((suppliers ?? []) as { id: string }[]).map((s) => s.id)
  const expr = ids.length ? `concept.ilike.%${search}%,supplier_id.in.(${ids.join(',')})` : `concept.ilike.%${search}%`
  let query = db.from('payables').select(SELECT).or(expr).order('due_date', { ascending: false }).limit(6)
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) throw new ToolError(`Error al buscar la factura: ${error.message}`)
  return (data ?? []) as PayableWithSupplier[]
}

/** By UUID, or the one payable whose concept/supplier matches — preferring `preferStatus` when given. */
export async function resolvePayable(db: Db, ref: string, preferStatus?: PayableStatus): Promise<PayableWithSupplier> {
  const raw = ref.trim()
  if (!raw) throw new ToolError('Indica la factura (id, concepto o proveedor)')
  if (isUuid(raw)) {
    const { data, error } = await db.from('payables').select(SELECT).eq('id', raw).single()
    if (error || !data) throw new ToolError('Factura no encontrada')
    return data as PayableWithSupplier
  }
  const search = sanitizeSearch(raw)
  let rows = await findPayables(db, search, preferStatus)
  if (rows.length === 0 && preferStatus) rows = await findPayables(db, search)
  return requireSingleMatch(rows, label, 'factura por pagar', search)
}

export interface ListPayablesInput {
  estado?: string
  /** Due month, YYYY-MM. */
  mes?: string
  proveedor?: string
  concepto?: string
  limit?: number
}

export async function listPayables(db: Db, input: ListPayablesInput = {}) {
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)))
  const today = todayInMexico()
  let query = db
    .from('payables')
    .select(SELECT, { count: 'exact' })
    .order('due_date', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)

  const estado = input.estado?.trim()
  if (estado) {
    if (!PAYABLE_STATUSES.includes(estado as PayableStatus)) {
      throw new ToolError('Estado inválido — usa pending | paid | cancelled')
    }
    query = query.eq('status', estado)
  }
  if (input.mes) {
    if (!ISO_MONTH.test(input.mes)) throw new ToolError('Mes inválido — usa YYYY-MM')
    const { from, toExclusive } = monthRange(input.mes)
    query = query.gte('due_date', from).lt('due_date', toExclusive)
  }
  if (input.proveedor) {
    const supplier = await resolveSupplier(db, input.proveedor)
    query = query.eq('supplier_id', supplier.id)
  }
  const concepto = sanitizeSearch(input.concepto ?? '')
  if (concepto) query = query.ilike('concept', `%${concepto}%`)

  const { data, error, count } = await query
  if (error) throw new ToolError(`Error al leer las facturas por pagar: ${error.message}`)
  const rows = (data ?? []) as PayableWithSupplier[]
  return {
    hoy: today,
    total_coincidencias: count ?? rows.length,
    mostradas: rows.length,
    suma_mostrada: rows.reduce((sum, r) => sum + r.amount, 0),
    facturas: rows.map((r) => digest(r, today)),
  }
}

/** The caller's role, read with their own token (each profile row is visible to its owner). */
async function isAdmin(db: Db, callerId: string): Promise<boolean> {
  const { data } = await db.from('profiles').select('role').eq('id', callerId).single()
  return (data as { role?: string } | null)?.role === 'admin'
}

export async function getPayable(db: Db, callerId: string, ref: string) {
  const payable = await resolvePayable(db, ref)
  const detail = {
    ...digest(payable, todayInMexico()),
    plazo_proveedor_dias: payable.supplier?.payment_terms_days ?? null,
  }
  // A member's answer must not even carry the key: the trail's existence is admin-only (ADR-028).
  if (!(await isAdmin(db, callerId))) return detail

  const { data, error } = await db
    .from('audit_events')
    .select('id, action, actor_name, data, created_at')
    .eq('entity_type', 'payable')
    .eq('entity_id', payable.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(100)
  if (error) throw new ToolError(`Error al leer el historial: ${error.message}`)
  return {
    ...detail,
    historial: ((data ?? []) as AuditEvent[]).map((e) => ({
      cuando: e.created_at,
      quien: e.actor_name ?? 'Sistema',
      que: describeAuditEvent(e, (iso) => iso),
    })),
  }
}

export async function getPayablesOverview(db: Db, input: { mes?: string } = {}) {
  const today = todayInMexico()
  const month = input.mes ?? today.slice(0, 7)
  if (!ISO_MONTH.test(month)) throw new ToolError('Mes inválido — usa YYYY-MM')
  const { from, toExclusive } = monthRange(month)

  const [pendingRes, paidRes] = await Promise.all([
    db
      .from('payables')
      .select(SELECT, { count: 'exact' })
      .eq('status', 'pending')
      .order('due_date', { ascending: true })
      .order('id', { ascending: true })
      .limit(OVERVIEW_LIMIT),
    db
      .from('payables')
      .select(SELECT, { count: 'exact' })
      .eq('status', 'paid')
      .gte('paid_at', from)
      .lt('paid_at', toExclusive)
      .order('paid_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(OVERVIEW_LIMIT),
  ])
  if (pendingRes.error || paidRes.error) {
    throw new ToolError(`Error al leer las facturas por pagar: ${(pendingRes.error ?? paidRes.error)?.message}`)
  }
  const pending = (pendingRes.data ?? []) as PayableWithSupplier[]
  const paid = (paidRes.data ?? []) as PayableWithSupplier[]
  const summary = summarizeMonth([...pending, ...paid], month, today)
  const truncated = (pendingRes.count ?? 0) > OVERVIEW_LIMIT || (paidRes.count ?? 0) > OVERVIEW_LIMIT

  return {
    mes: month,
    hoy: today,
    pendiente_del_mes: { total: summary.pendingTotal, facturas: summary.pendingCount },
    vencido: {
      total: summary.overdueTotal,
      facturas: summary.overdueCount,
      de_meses_anteriores: { total: summary.carryOverTotal, facturas: summary.carryOverCount },
    },
    por_vencer_en_7_dias: { total: summary.dueSoonTotal, facturas: summary.dueSoonCount },
    pagado_en_el_mes: { total: summary.paidTotal, facturas: summary.paidCount },
    semanas_del_mes: summary.weeks.map((w) => ({ semana: w.label, total: w.total, facturas: w.count })),
    proximas: pending.slice(0, 15).map((p) => digest(p, today)),
    nota: truncated ? 'Lectura truncada a 1000 facturas por estado: los totales pueden quedar cortos.' : null,
  }
}

export interface MarkPayablePaidInput {
  /** UUID, or part of the concept / supplier name. */
  factura: string
  /** false = back to pending. Default true. */
  pagada?: boolean
  /** Real payment date, YYYY-MM-DD; default today (Mexico). */
  fecha_pago?: string
}

export async function markPayablePaid(db: Db, input: MarkPayablePaidInput) {
  const pagada = input.pagada ?? true
  const target = await resolvePayable(db, input.factura, pagada ? 'pending' : 'paid')
  if (target.status === 'cancelled') {
    throw new ToolError(`"${target.concept}" está cancelada; reactívala desde la app.`)
  }
  if (!pagada && target.status === 'pending') {
    throw new ToolError(`"${target.concept}" ya está pendiente.`)
  }
  // A bare "paid" again would re-stamp today's date over the real one (#100).
  if (pagada && target.status === 'paid' && !input.fecha_pago) {
    throw new ToolError(
      `"${target.concept}" ya estaba pagada el ${target.paid_at}; si quieres corregir la fecha indícala en fecha_pago.`,
    )
  }
  const payment = resolvePaymentUpdate(pagada ? 'paid' : 'pending', input.fecha_pago, todayInMexico())
  if (!payment.ok) throw new ToolError(payment.error)

  const { data, error } = await db.from('payables').update(payment.updates).eq('id', target.id).select(SELECT).single()
  if (error || !data) throw new ToolError(`Error al actualizar la factura: ${error?.message ?? 'sin datos'}`)
  const row = data as PayableWithSupplier
  return {
    ...digest(row, todayInMexico()),
    // No mention of the audit trail: a member can run this and must not learn it exists (ADR-028).
    nota: pagada ? `Marcada como pagada el ${row.paid_at}.` : 'Regresada a pendiente.',
  }
}

export interface CreatePayableInput {
  proveedor: string
  concepto: string
  monto: number
  fecha_factura: string
  /** Default: invoice date + the supplier's credit days (as the app pre-fills it). */
  vencimiento?: string
  notas?: string
}

export async function createPayable(db: Db, input: CreatePayableInput) {
  const concept = (input.concepto ?? '').trim()
  if (!concept) throw new ToolError('El concepto es obligatorio')
  if (typeof input.monto !== 'number' || !Number.isFinite(input.monto) || input.monto <= 0) {
    throw new ToolError('El monto debe ser mayor a 0')
  }
  if (typeof input.fecha_factura !== 'string' || !ISO_DATE.test(input.fecha_factura)) {
    throw new ToolError('Fecha de factura inválida — usa YYYY-MM-DD')
  }
  if (input.vencimiento !== undefined && !ISO_DATE.test(input.vencimiento)) {
    throw new ToolError('Fecha de vencimiento inválida — usa YYYY-MM-DD')
  }
  const supplier = await resolveSupplier(db, input.proveedor)
  const dueDate = input.vencimiento ?? dueDateFrom(input.fecha_factura, supplier.payment_terms_days)

  const { data, error } = await db
    .from('payables')
    .insert({
      supplier_id: supplier.id,
      concept,
      amount: input.monto,
      invoice_date: input.fecha_factura,
      due_date: dueDate,
      status: 'pending',
      paid_at: null,
      notes: input.notas?.trim() || null,
    })
    .select(SELECT)
    .single()
  if (error || !data) throw new ToolError(`Error al registrar la factura: ${error?.message ?? 'sin datos'}`)
  return {
    ...digest(data as PayableWithSupplier, todayInMexico()),
    nota: input.vencimiento
      ? 'Registrada como pendiente.'
      : `Registrada como pendiente; vencimiento calculado con el plazo del proveedor (${paymentTermsLabel(supplier.payment_terms_days)}).`,
  }
}
