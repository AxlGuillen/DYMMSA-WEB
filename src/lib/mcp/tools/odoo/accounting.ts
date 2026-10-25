/** Odoo phase 1 — accounting (ADR-025), read-only: injected caller, catalog as the boundary, digested responses. */

import type { OdooCaller } from '@/lib/odoo/client'
import { allowedFields, assertDomainAllowed, catalogEntry, type DomainTriple } from '@/lib/odoo/catalog'
import { htmlToText, normalizeGroups, normalizeRecords } from '@/lib/odoo/normalize'
import { ToolError } from '@/lib/mcp/core/errors'
import { assertDateRange } from './dates'

const MAX_LIMIT = 50

export interface SearchRecordsInput {
  modelo: string
  filtros?: DomainTriple[]
  campos?: string[]
  limite?: number
  orden?: string
  saltar?: number
}

/** Validates EVERY order column — checking only the first let hidden fields through (PR #66). */
function assertOrderAllowed(model: string, order: string): void {
  const columns = order
    .split(',')
    .map((col) => col.trim().split(/\s+/)[0])
    .filter(Boolean)
  assertDomainAllowed(model, columns.map((field): DomainTriple => [field, '=', null]))
}

export async function odooSearchRecords(odoo: OdooCaller, input: SearchRecordsInput) {
  const fields = allowedFields(input.modelo, input.campos)
  const domain = input.filtros ?? []
  assertDomainAllowed(input.modelo, domain)
  if (input.orden) assertOrderAllowed(input.modelo, input.orden)

  const limit = Math.min(MAX_LIMIT, Math.max(1, input.limite ?? 20))
  const records = await odoo(input.modelo, 'search_read', {
    domain,
    fields,
    limit,
    offset: Math.max(0, input.saltar ?? 0),
    ...(input.orden ? { order: input.orden } : {}),
  })
  // narration is HTML in Odoo; the server digests, the model interprets (review PR #116).
  const items = normalizeRecords(records).map((item) =>
    'narration' in item ? { ...item, narration: htmlToText(item.narration) } : item,
  )
  return {
    model: input.modelo,
    count: items.length,
    // undefined disappears on serialize: warn only when the limit was filled.
    nota: items.length === limit
      ? `Se devolvió el máximo (${limit}); usa saltar o filtra más para ver el resto.`
      : undefined,
    items,
  }
}

export interface AggregateRecordsInput {
  modelo: string
  filtros?: DomainTriple[]
  agrupar_por: string
  metricas?: string[]
}

const AGGREGATORS = new Set(['sum', 'avg', 'min', 'max', 'count'])

export async function odooAggregateRecords(odoo: OdooCaller, input: AggregateRecordsInput) {
  catalogEntry(input.modelo)
  const domain = input.filtros ?? []
  assertDomainAllowed(input.modelo, domain)
  assertDomainAllowed(input.modelo, [[input.agrupar_por, '=', null]])

  const metrics = input.metricas ?? []
  for (const metric of metrics) {
    const [field, agg] = metric.split(':')
    if (!agg || !AGGREGATORS.has(agg)) {
      throw new ToolError(`Métrica inválida "${metric}": usa el formato campo:sum|avg|min|max|count`)
    }
    assertDomainAllowed(input.modelo, [[field, '=', null]])
  }

  const groups = await odoo(input.modelo, 'read_group', {
    domain,
    fields: metrics,
    groupby: [input.agrupar_por],
  })
  return { model: input.modelo, agrupado_por: input.agrupar_por, grupos: normalizeGroups(groups) }
}

/** Unsigned like the app loader: a signed instance must not net by accident (ADR-027 §8). */
const abs = (v: unknown) => Math.abs((v as number) ?? 0)

export interface SummarizeInvoicesInput {
  desde?: string
  hasta?: string
  agrupar_por?: 'estado_pago' | 'cliente' | 'mes'
}

const GROUP_FIELD: Record<NonNullable<SummarizeInvoicesInput['agrupar_por']>, string> = {
  estado_pago: 'payment_state',
  cliente: 'partner_id',
  mes: 'invoice_date:month',
}

export async function odooSummarizeInvoices(odoo: OdooCaller, input: SummarizeInvoicesInput = {}) {
  assertDateRange(input.desde, input.hasta)
  const period: DomainTriple[] = [
    ...(input.desde ? [['invoice_date', '>=', input.desde] as DomainTriple] : []),
    ...(input.hasta ? [['invoice_date', '<=', input.hasta] as DomainTriple] : []),
  ]
  const domain: DomainTriple[] = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ...period]
  const groupBy = GROUP_FIELD[input.agrupar_por ?? 'estado_pago']

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
    periodo: { desde: input.desde ?? 'inicio', hasta: input.hasta ?? 'hoy' },
    agrupado_por: input.agrupar_por ?? 'estado_pago',
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
