/**
 * Payables module (#84/#100): reads + the first writes outside the core (#109, ADR-030).
 * Same rules as the routes through the shared helpers; the audit trigger attributes every
 * write to the token's user, so nothing here touches audit_events.
 */

import { isAdminNow } from '@/lib/mcp/core/auth/live-admin'
import { sanitizeSearch } from '@/lib/text'
import { resolveByName } from '@/lib/mcp/core/lookup'
import { ToolError } from '@/lib/mcp/core/errors'
import { listResult, refOf } from '@/lib/mcp/core/envelope'
import { normalizePagination } from '@/lib/mcp/core/schema'
import type { Db } from '@/lib/mcp/core/db'
import { resolveSupplier } from './suppliers'
import { formatMoney, todayInMexico } from '@/lib/format'
import { ISO_MONTH, monthRange } from '@/lib/month'
import {
  daysUntilDue,
  describeAuditEvent,
  PAYABLE_STATUS_TOKENS,
  PAYABLE_FILTER_TOKENS,
  resolvePayableFilter,
  splitByCurrency,
  summarizeMonth,
  payableTotals,
  DEFAULT_PAYABLE_CURRENCY,
  type PayablesMonthSummary,
} from '@/lib/payables'
import type { AuditEvent, PayableStatus, PayableWithSupplier } from '@/types/database'

const SELECT = '*, supplier:suppliers(id, name, payment_terms_days)'
// Same caps as /api/payables/overview: a silent cut would lie, so the result says when it hit them.
const OVERVIEW_LIMIT = 1000

export function digest(p: PayableWithSupplier, today: string) {
  return {
    ref: refOf(p.id),
    proveedor: p.supplier?.name ?? null,
    concepto: p.concept,
    monto: p.amount,
    moneda: p.currency ?? DEFAULT_PAYABLE_CURRENCY,
    fecha_factura: p.invoice_date,
    vencimiento: p.due_date,
    dias_para_vencer: p.status === 'pending' ? daysUntilDue(p.due_date, today) : null,
    estado: PAYABLE_STATUS_TOKENS.toToken(p.status),
    pagada_el: p.paid_at,
    notas: p.notes,
  }
}

const label = (p: PayableWithSupplier) =>
  `${p.supplier?.name ?? '?'} · ${p.concept} · $${p.amount} ${p.currency ?? DEFAULT_PAYABLE_CURRENCY} (${PAYABLE_STATUS_TOKENS.toToken(p.status)})`

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

/** By UUID, ref, or the one payable whose concept/supplier matches — preferring `preferStatus` when given. */
export async function resolvePayable(db: Db, reference: string, preferStatus?: PayableStatus): Promise<PayableWithSupplier> {
  return resolveByName<PayableWithSupplier>(
    db,
    {
      table: 'payables',
      select: SELECT,
      what: 'factura por pagar',
      article: 'la',
      label,
      search: async (client, query) => {
        const rows = await findPayables(client, query, preferStatus)
        return rows.length === 0 && preferStatus ? findPayables(client, query) : rows
      },
    },
    reference,
  )
}

export interface ListPayablesInput {
  estado?: string
  /** Due month, YYYY-MM. */
  mes?: string
  proveedor?: string
  concepto?: string
  pagina?: number
  por_pagina?: number
}

export async function listPayables(db: Db, input: ListPayablesInput = {}) {
  const { pagina, por_pagina, from: rangeFrom, to: rangeTo } = normalizePagination(input, 50)
  const today = todayInMexico()
  let query = db
    .from('payables')
    .select(SELECT, { count: 'exact' })
    .order('due_date', { ascending: true })
    .order('id', { ascending: true })
    .range(rangeFrom, rangeTo)

  const estado = input.estado?.trim()
  if (estado) {
    const dbFilter = PAYABLE_FILTER_TOKENS.toDb(estado)
    const filter = dbFilter ? resolvePayableFilter(dbFilter, today) : null
    if (!filter) throw new ToolError(`Estado inválido — usa ${PAYABLE_FILTER_TOKENS.tokens.join(' | ')}`)
    query = query.eq('status', filter.status)
    if (filter.dueBefore) query = query.lt('due_date', filter.dueBefore)
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
    // Per currency, never added together (2026-10-20); only this page, which the envelope's total says.
    suma_de_esta_pagina: payableTotals(rows).byCurrency,
    ...listResult('facturas', rows.map((r) => digest(r, today)), { total: count ?? rows.length, pagina, por_pagina }),
  }
}

export async function getPayable(db: Db, callerId: string, ref: string) {
  const payable = await resolvePayable(db, ref)
  const detail = {
    ...digest(payable, todayInMexico()),
    plazo_proveedor_dias: payable.supplier?.payment_terms_days ?? null,
  }
  // A member's answer must not even carry the key: the trail's existence is admin-only (ADR-028).
  if (!(await isAdminNow(db, callerId))) return detail

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
      que: describeAuditEvent(e, (iso) => iso, formatMoney),
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
  // The closing is in pesos; other currencies are summarized apart, never converted (2026-10-20).
  const { mxn, foreign } = splitByCurrency([...pending, ...paid])
  const summary = summarizeMonth(mxn, month, today)
  const brief = (s: PayablesMonthSummary) => ({
    pendiente_del_mes: s.pendingTotal,
    vencido: s.overdueTotal,
    pagado_en_el_mes: s.paidTotal,
  })
  const enOtrasMonedas = Object.fromEntries(
    Object.entries(foreign).map(([currency, rows]) => [currency, brief(summarizeMonth(rows, month, today))]),
  )
  const truncated = (pendingRes.count ?? 0) > OVERVIEW_LIMIT || (paidRes.count ?? 0) > OVERVIEW_LIMIT

  return {
    mes: month,
    hoy: today,
    moneda: DEFAULT_PAYABLE_CURRENCY,
    pendiente_del_mes: { total: summary.pendingTotal, facturas: summary.pendingCount },
    vencido: {
      total: summary.overdueTotal,
      facturas: summary.overdueCount,
      de_meses_anteriores: { total: summary.carryOverTotal, facturas: summary.carryOverCount },
    },
    por_vencer_en_7_dias: { total: summary.dueSoonTotal, facturas: summary.dueSoonCount },
    pagado_en_el_mes: { total: summary.paidTotal, facturas: summary.paidCount },
    semanas_del_mes: summary.weeks.map((w) => ({ semana: w.label, total: w.total, facturas: w.count })),
    ...(Object.keys(enOtrasMonedas).length ? { en_otras_monedas_sin_convertir: enOtrasMonedas } : {}),
    proximas: pending.slice(0, 15).map((p) => digest(p, today)),
    nota: truncated ? 'Lectura truncada a 1000 facturas por estado: los totales pueden quedar cortos.' : null,
  }
}

