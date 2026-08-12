/**
 * Bloque Odoo — Fase 1: Contabilidad (issue #65, ADR-025). SOLO lectura.
 *
 * Las tools reciben el caller por parámetro (inyección, como `Db` en las de
 * Supabase) y responden JSON compacto ya digerido: agregados calculados por
 * Odoo (`read_group`), many2one como nombres y `false` → null. Toda entrada
 * pasa por el catálogo (modelos y campos permitidos) ANTES de viajar a Odoo.
 */

import type { OdooCaller } from '@/lib/odoo/client'
import { allowedFields, assertDomainAllowed, catalogEntry, type DomainTriple } from '@/lib/odoo/catalog'
import { daysSince, normalizeGroups, normalizeRecords, todayIso } from '@/lib/odoo/normalize'
import { ToolError } from '../../shared'

const MAX_LIMIT = 50

// ── Primitivas genéricas (cola larga de preguntas) ─────────────────────

export interface OdooQueryInput {
  model: string
  domain?: DomainTriple[]
  fields?: string[]
  limit?: number
  order?: string
  offset?: number
}

/**
 * Valida CADA columna de un `order` ("invoice_date asc, name desc") contra el
 * catálogo — validar solo la primera dejaba pasar campos ocultos en el resto
 * (review PR #66; mismo canal de inferencia que el traversal en dominios).
 */
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
  const items = normalizeRecords(records)
  return {
    model: input.model,
    count: items.length,
    // undefined desaparece al serializar: solo avisa cuando llenó el límite.
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

// ── Tools curadas de contabilidad ──────────────────────────────────────

/** Facturas de cliente contabilizadas con saldo pendiente y fecha vencida. */
export const overdueDomain = (today: string): DomainTriple[] => [
  ['move_type', '=', 'out_invoice'],
  ['state', '=', 'posted'],
  ['payment_state', 'in', ['not_paid', 'partial']],
  ['invoice_date_due', '<', today],
  ['amount_residual', '>', 0],
]

export async function odooOverdueInvoices(odoo: OdooCaller, input: { limit?: number } = {}) {
  const today = todayIso()
  const domain = overdueDomain(today)

  // 2 llamadas exactas (rate limit): agregado por cliente + las más vencidas.
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

  return {
    corte: today,
    total_vencido: porCliente.reduce((sum, c) => sum + c.monto_pendiente, 0),
    facturas_vencidas: porCliente.reduce((sum, c) => sum + c.facturas, 0),
    por_cliente: porCliente,
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const GROUP_FIELD: Record<NonNullable<InvoicesSummaryInput['group_by']>, string> = {
  estado_pago: 'payment_state',
  cliente: 'partner_id',
  mes: 'invoice_date:month',
}

export async function odooInvoicesSummary(odoo: OdooCaller, input: InvoicesSummaryInput = {}) {
  for (const date of [input.date_from, input.date_to]) {
    if (date && !DATE_RE.test(date)) throw new ToolError(`Fecha inválida "${date}" — usa YYYY-MM-DD`)
  }
  const domain: DomainTriple[] = [
    ['move_type', '=', 'out_invoice'],
    ['state', '=', 'posted'],
    ...(input.date_from ? [['invoice_date', '>=', input.date_from] as DomainTriple] : []),
    ...(input.date_to ? [['invoice_date', '<=', input.date_to] as DomainTriple] : []),
  ]
  const groupBy = GROUP_FIELD[input.group_by ?? 'estado_pago']

  const grupos = normalizeGroups(
    await odoo('account.move', 'read_group', {
      domain,
      fields: ['amount_total:sum', 'amount_residual:sum'],
      groupby: [groupBy],
    }),
  )

  return {
    periodo: { desde: input.date_from ?? 'inicio', hasta: input.date_to ?? 'hoy' },
    agrupado_por: input.group_by ?? 'estado_pago',
    total_facturado: grupos.reduce((sum, g) => sum + ((g.amount_total as number) ?? 0), 0),
    total_pendiente: grupos.reduce((sum, g) => sum + ((g.amount_residual as number) ?? 0), 0),
    grupos,
  }
}
