/** Odoo phase 1 — accounting (ADR-025), read-only: injected caller, catalog as the boundary, digested responses. */

import type { OdooCaller } from '@/lib/odoo/client'
import { allowedFields, assertDomainAllowed, catalogEntry, type DomainTriple } from '@/lib/odoo/catalog'
import { htmlToText, normalizeGroups, normalizeRecords } from '@/lib/odoo/normalize'
import { ToolError } from '@/lib/mcp/core/errors'
import { assertDateRange } from './dates'

const MAX_LIMIT = 50

export interface SearchRecordsInput {
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

export async function odooSearchRecords(odoo: OdooCaller, input: SearchRecordsInput) {
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

export interface AggregateRecordsInput {
  model: string
  domain?: DomainTriple[]
  group_by: string
  metrics?: string[]
}

const AGGREGATORS = new Set(['sum', 'avg', 'min', 'max', 'count'])

export async function odooAggregateRecords(odoo: OdooCaller, input: AggregateRecordsInput) {
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

export interface SummarizeInvoicesInput {
  date_from?: string
  date_to?: string
  group_by?: 'estado_pago' | 'cliente' | 'mes'
}

const GROUP_FIELD: Record<NonNullable<SummarizeInvoicesInput['group_by']>, string> = {
  estado_pago: 'payment_state',
  cliente: 'partner_id',
  mes: 'invoice_date:month',
}

export async function odooSummarizeInvoices(odoo: OdooCaller, input: SummarizeInvoicesInput = {}) {
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
