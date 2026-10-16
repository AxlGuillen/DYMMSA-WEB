/** Odoo phase 1 — accounting (ADR-025), read-only: injected caller, catalog as the boundary, digested responses. */

import type { OdooCaller } from '@/lib/odoo/client'
import { allowedFields, assertDomainAllowed, catalogEntry, type DomainTriple } from '@/lib/odoo/catalog'
import { daysSince, htmlToText, normalizeGroups, normalizeRecords, todayIso } from '@/lib/odoo/normalize'
import { OPEN_CREDIT_NOTES_DOMAIN, overdueDomain } from '@/lib/odoo/domains'
import { fetchOpenCustomerMoves } from '@/lib/odoo/income'
import {
  customerCreditNotes,
  customersTotals,
  customerStatement,
  daysLabel,
  rangeLabel,
  statementLines,
  summarizeCustomers,
  type StatementFilter,
  type StatementLine,
  type StatementRange,
} from '@/lib/customers'
import { isRealDate } from '@/lib/month'
import { fold, requireSingleMatch, ToolError } from '../../shared'
import { assertDateRange } from './dates'

const MAX_LIMIT = 50

export interface OdooQueryInput {
  model: string
  domain?: DomainTriple[]
  fields?: string[]
  limit?: number
  order?: string
  offset?: number
}

/** Validates EVERY order column — checking only the first let hidden fields through (PR #66). */
function assertOrderAllowed(model: string, order: string): void {
  const columns = order
    .split(',')
    .map((col) => col.trim().split(/\s+/)[0])
    .filter(Boolean)
  assertDomainAllowed(model, columns.map((field): DomainTriple => [field, '=', null]))
}

export async function odooQuery(odoo: OdooCaller, input: OdooQueryInput) {
  const fields = allowedFields(input.model, input.fields)
  const domain = input.domain ?? []
  assertDomainAllowed(input.model, domain)
  if (input.order) assertOrderAllowed(input.model, input.order)

  const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? 20))
  const records = await odoo(input.model, 'search_read', {
    domain,
    fields,
    limit,
    offset: Math.max(0, input.offset ?? 0),
    ...(input.order ? { order: input.order } : {}),
  })
  // narration is HTML in Odoo; the server digests, the model interprets (review PR #116).
  const items = normalizeRecords(records).map((item) =>
    'narration' in item ? { ...item, narration: htmlToText(item.narration) } : item,
  )
  return {
    model: input.model,
    count: items.length,
    // undefined disappears on serialize: warn only when the limit was filled.
    nota: items.length === limit
      ? `Se devolvió el máximo (${limit}); usa offset o filtra más para ver el resto.`
      : undefined,
    items,
  }
}

export interface OdooAggregateInput {
  model: string
  domain?: DomainTriple[]
  group_by: string
  metrics?: string[]
}

const AGGREGATORS = new Set(['sum', 'avg', 'min', 'max', 'count'])

export async function odooAggregate(odoo: OdooCaller, input: OdooAggregateInput) {
  catalogEntry(input.model)
  const domain = input.domain ?? []
  assertDomainAllowed(input.model, domain)
  assertDomainAllowed(input.model, [[input.group_by, '=', null]])

  const metrics = input.metrics ?? []
  for (const metric of metrics) {
    const [field, agg] = metric.split(':')
    if (!agg || !AGGREGATORS.has(agg)) {
      throw new ToolError(`Métrica inválida "${metric}": usa el formato campo:sum|avg|min|max|count`)
    }
    assertDomainAllowed(input.model, [[field, '=', null]])
  }

  const groups = await odoo(input.model, 'read_group', {
    domain,
    fields: metrics,
    groupby: [input.group_by],
  })
  return { model: input.model, agrupado_por: input.group_by, grupos: normalizeGroups(groups) }
}

/** Unsigned like the app loader: a signed instance must not net by accident (ADR-027 §8). */
const abs = (v: unknown) => Math.abs((v as number) ?? 0)

/** Unapplied credit notes per customer, aggregated (exact total): informed apart, never netted (#102). */
export async function creditNotesByCustomer(odoo: OdooCaller, extra: DomainTriple[] = []) {
  const groups = normalizeGroups(
    await odoo('account.move', 'read_group', {
      domain: [...OPEN_CREDIT_NOTES_DOMAIN, ...extra],
      fields: ['amount_residual:sum'],
      groupby: ['partner_id'],
    }),
  )
  const porCliente = groups
    .map((g) => ({
      cliente: (g.partner_id as string | null) ?? 'Sin cliente',
      notas: (g.count as number) ?? 0,
      saldo_a_favor: abs(g.amount_residual),
    }))
    .sort((a, b) => b.saldo_a_favor - a.saldo_a_favor)
  return {
    total: porCliente.reduce((sum, c) => sum + c.saldo_a_favor, 0),
    documentos: porCliente.reduce((sum, c) => sum + c.notas, 0),
    por_cliente: porCliente,
  }
}

export interface OverdueInvoicesInput {
  limit?: number
  cliente?: string
  vence_desde?: string
  vence_hasta?: string
  incluir?: 'vencidas' | 'por_vencer' | 'ambas'
}

const INCLUDE_FILTER: Record<NonNullable<OverdueInvoicesInput['incluir']>, StatementFilter> = {
  vencidas: 'overdue',
  por_vencer: 'upcoming',
  ambas: 'all',
}

/**
 * Account statement mode (#145): same rules and lib as the Clientes screens — one read of the open moves,
 * window on the DUE date, credit notes apart and never subtracted (#102). Absent dates = no bound.
 */
async function accountStatement(odoo: OdooCaller, input: OverdueInvoicesInput) {
  assertDateRange(input.vence_desde, input.vence_hasta)
  for (const date of [input.vence_desde, input.vence_hasta]) {
    // Shape AND existence: 2026-02-30 passes the regex (review PR #128).
    if (date && !isRealDate(date)) throw new ToolError(`Fecha inexistente "${date}"`)
  }
  const today = todayIso()
  // A date window asks about what falls due in it: with only "vencidas" a future window would be a confident zero.
  const incluir = input.incluir ?? (input.vence_desde || input.vence_hasta ? 'ambas' : 'vencidas')
  const range: StatementRange = {
    from: input.vence_desde ?? null,
    to: input.vence_hasta ?? null,
    filter: INCLUDE_FILTER[incluir],
  }
  const moves = await fetchOpenCustomerMoves(odoo)
  const header = {
    corte: today,
    rango: rangeLabel(range, (iso) => iso),
    incluye: incluir,
    // undefined disappears on serialize: warn only when the read filled its limit.
    nota: moves.truncated ? 'Odoo devolvió el máximo de facturas abiertas: puede faltar alguna.' : undefined,
  }
  const line = (l: StatementLine) => ({
    folio: l.folio,
    emitida: l.invoiceDate,
    vence: l.dueDate,
    estado: l.status === 'overdue' ? 'vencida' : 'por vencer',
    dias: daysLabel(l),
    saldo: l.residual,
    total: l.total,
    moneda: l.currency,
  })
  // undefined disappears on serialize: only mention currencies when something was summed unconverted.
  const unconverted = (currencies: string[]) => (currencies.length ? currencies : undefined)

  if (input.cliente) {
    // Only partners with open moves: a customer who owes nothing has no statement to give.
    const people = new Map<number, string>()
    for (const m of moves.rows) if (m.customerId !== null) people.set(m.customerId, m.customer ?? 'Sin nombre')
    const query = fold(input.cliente)
    if (!query) throw new ToolError('Indica el nombre del cliente')
    const exact = [...people].filter(([, n]) => fold(n) === query)
    const [id, name] = requireSingleMatch(
      exact.length > 0 ? exact : [...people].filter(([, n]) => fold(n).includes(query)),
      ([pid, n]) => `${n} (#${pid})`,
      'cliente con facturas abiertas',
      input.cliente,
    )
    const { lines, totals, currencies } = customerStatement(moves.rows, id, range, today)
    const credit = customerCreditNotes(moves.rows, id)
    return {
      ...header,
      cliente: name,
      total_por_cobrar: totals.total,
      total_vencido: totals.overdue,
      total_por_vencer: totals.upcoming,
      facturas: totals.count,
      monedas_sin_convertir: unconverted(currencies),
      detalle: lines.map(line),
      notas_credito_sin_aplicar: { total: credit.total, documentos: credit.count },
    }
  }

  const everyone = summarizeCustomers([], moves.rows, range, today)
  const totals = customersTotals(everyone)
  const rows = everyone.filter((r) => r.openInvoices > 0)
  const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? 10))
  const all = rows.flatMap((r) => statementLines(moves.rows, r.id, range, today).map((l) => ({ ...line(l), cliente: r.name })))
  return {
    ...header,
    total_por_cobrar: totals.total,
    total_vencido: totals.overdue,
    total_por_vencer: totals.upcoming,
    facturas: totals.openInvoices,
    monedas_sin_convertir: unconverted(totals.currencies),
    por_cliente: rows.map((r) => ({ cliente: r.name, facturas: r.openInvoices, vencido: r.overdue, por_vencer: r.upcoming, total: r.total })),
    // Every unapplied credit note, customers with only credit included: reported apart, never subtracted (#102).
    notas_credito_sin_aplicar: {
      total: totals.creditNotes,
      documentos: everyone.reduce((n, r) => n + r.creditNoteCount, 0),
    },
    // Oldest due first across customers; `limit` caps the list, the totals above cover everything.
    primeras: all.sort((a, b) => (a.vence ?? '').localeCompare(b.vence ?? '') || a.folio.localeCompare(b.folio)).slice(0, limit),
  }
}

export async function odooOverdueInvoices(odoo: OdooCaller, input: OverdueInvoicesInput = {}) {
  if (input.cliente || input.vence_desde || input.vence_hasta || input.incluir) return accountStatement(odoo, input)
  const today = todayIso()
  const domain = overdueDomain(today)

  // Exactly 3 calls (rate limit): aggregate per customer, the most overdue ones, credit notes.
  const byCustomer = normalizeGroups(
    await odoo('account.move', 'read_group', {
      domain,
      fields: ['amount_residual:sum'],
      groupby: ['partner_id'],
    }),
  )
  const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? 10))
  const oldest = normalizeRecords(
    await odoo('account.move', 'search_read', {
      domain,
      fields: ['name', 'partner_id', 'invoice_date', 'invoice_date_due', 'amount_total', 'amount_residual'],
      limit,
      order: 'invoice_date_due asc',
    }),
  )

  const porCliente = byCustomer
    .map((g) => ({
      cliente: (g.partner_id as string | null) ?? 'Sin cliente',
      facturas: (g.count as number) ?? 0,
      monto_pendiente: (g.amount_residual as number) ?? 0,
    }))
    .sort((a, b) => b.monto_pendiente - a.monto_pendiente)

  const notasCredito = await creditNotesByCustomer(odoo)

  return {
    corte: today,
    total_vencido: porCliente.reduce((sum, c) => sum + c.monto_pendiente, 0),
    facturas_vencidas: porCliente.reduce((sum, c) => sum + c.facturas, 0),
    por_cliente: porCliente,
    notas_credito_sin_aplicar: notasCredito,
    mas_vencidas: oldest.map((inv) => ({
      folio: inv.name,
      cliente: inv.partner_id,
      emitida: inv.invoice_date,
      vencio: inv.invoice_date_due,
      dias_vencida: typeof inv.invoice_date_due === 'string' ? daysSince(inv.invoice_date_due) : null,
      monto_pendiente: inv.amount_residual,
      monto_total: inv.amount_total,
    })),
  }
}

export interface InvoicesSummaryInput {
  date_from?: string
  date_to?: string
  group_by?: 'estado_pago' | 'cliente' | 'mes'
}

const GROUP_FIELD: Record<NonNullable<InvoicesSummaryInput['group_by']>, string> = {
  estado_pago: 'payment_state',
  cliente: 'partner_id',
  mes: 'invoice_date:month',
}

export async function odooInvoicesSummary(odoo: OdooCaller, input: InvoicesSummaryInput = {}) {
  assertDateRange(input.date_from, input.date_to)
  const period: DomainTriple[] = [
    ...(input.date_from ? [['invoice_date', '>=', input.date_from] as DomainTriple] : []),
    ...(input.date_to ? [['invoice_date', '<=', input.date_to] as DomainTriple] : []),
  ]
  const domain: DomainTriple[] = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ...period]
  const groupBy = GROUP_FIELD[input.group_by ?? 'estado_pago']

  const grupos = normalizeGroups(
    await odoo('account.move', 'read_group', {
      domain,
      fields: ['amount_total:sum', 'amount_residual:sum'],
      groupby: [groupBy],
    }),
  )
  // Credit notes of the same period, apart: they are customer credit, not invoicing (#102).
  const notas = normalizeGroups(
    await odoo('account.move', 'read_group', {
      domain: [['move_type', '=', 'out_refund'], ['state', '=', 'posted'], ...period],
      fields: ['amount_total:sum', 'amount_residual:sum'],
      groupby: ['payment_state'],
    }),
  )

  return {
    periodo: { desde: input.date_from ?? 'inicio', hasta: input.date_to ?? 'hoy' },
    agrupado_por: input.group_by ?? 'estado_pago',
    total_facturado: grupos.reduce((sum, g) => sum + ((g.amount_total as number) ?? 0), 0),
    total_pendiente: grupos.reduce((sum, g) => sum + ((g.amount_residual as number) ?? 0), 0),
    grupos,
    notas_credito: {
      total: notas.reduce((sum, g) => sum + abs(g.amount_total), 0),
      sin_aplicar: notas.reduce((sum, g) => sum + abs(g.amount_residual), 0),
      documentos: notas.reduce((sum, g) => sum + ((g.count as number) ?? 0), 0),
    },
  }
}
