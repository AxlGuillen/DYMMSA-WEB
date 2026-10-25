/**
 * One customer (#155, ADR-041): the profile and its account statement in one call. The statement is
 * the figure (gross per invoice, by DUE date, like the Clientes screen); Odoo's net ledger rides apart.
 */

import type { OdooCaller } from '@/lib/odoo/client'
import { fetchOpenCustomerMoves } from '@/lib/odoo/income'
import { normalizeGroups, normalizeRecord, todayIso } from '@/lib/odoo/normalize'
import {
  customerCreditNotes,
  customerStatement,
  defaultStatementRange,
  rangeLabel,
  type StatementFilter,
  type StatementRange,
} from '@/lib/customers'
import { isRealDate } from '@/lib/month'
import { ToolError } from '@/lib/mcp/core/errors'
import { assertDateRange } from './dates'
import { CARTERA_NOTA, receivableBlock, statementLineOut, unconverted } from './receivables'
import { resolvePartner } from './resolve'

export const STATEMENT_INCLUDE = ['vencidas', 'por_vencer', 'ambas'] as const
export type StatementInclude = (typeof STATEMENT_INCLUDE)[number]

const INCLUDE_FILTER: Record<StatementInclude, StatementFilter> = { vencidas: 'overdue', por_vencer: 'upcoming', ambas: 'all' }

const STATEMENT_LIMIT = 50
const CREDIT_NOTES_LIMIT = 10
const CONFIRMED_SALES = new Set(['sale', 'done'])
// Contact plus Odoo's receivable figures (#113): computed per record, read explicitly, never filtered.
const PROFILE_FIELDS = ['email', 'phone', 'city', 'country_id', 'total_due', 'total_overdue', 'days_sales_outstanding']

export interface GetCustomerInput {
  cliente: string
  vence_desde?: string
  vence_hasta?: string
  incluir?: StatementInclude
}

/** Same default as the screen (review PR #148): no dates nor `incluir` = everything overdue + this month, both kinds. */
function statementRange(input: GetCustomerInput, today: string): StatementRange {
  const screenDefault = !input.incluir && !input.vence_desde && !input.vence_hasta
  return {
    from: input.vence_desde ?? null,
    to: input.vence_hasta ?? (screenDefault ? defaultStatementRange(today).to : null),
    filter: INCLUDE_FILTER[input.incluir ?? 'ambas'],
  }
}

export async function odooGetCustomer(odoo: OdooCaller, input: GetCustomerInput) {
  assertDateRange(input.vence_desde, input.vence_hasta)
  for (const date of [input.vence_desde, input.vence_hasta]) {
    // Shape AND existence: 2026-02-30 passes the regex (review PR #128).
    if (date && !isRealDate(date)) throw new ToolError(`Fecha inexistente "${date}"`)
  }
  const today = todayIso()
  const range = statementRange(input, today)

  // 4 calls (+1 only to find an archived one): the partner, its open moves, its sales, its invoicing.
  const { partner, row, archived } = await resolvePartner(odoo, input.cliente, { fields: PROFILE_FIELDS, archived: 'read' })
  const moves = await fetchOpenCustomerMoves(odoo, [['partner_id', '=', partner.id]])
  const ventas = normalizeGroups(
    await odoo('sale.order', 'read_group', {
      domain: [['partner_id', '=', partner.id]],
      fields: ['amount_total:sum'],
      groupby: ['state'],
    }),
  )
  const facturacion = normalizeGroups(
    await odoo('account.move', 'read_group', {
      domain: [['partner_id', '=', partner.id], ['move_type', '=', 'out_invoice'], ['state', '=', 'posted']],
      fields: ['amount_total:sum', 'amount_residual:sum'],
      groupby: ['payment_state'],
    }),
  )

  const statement = customerStatement(moves.rows, partner.id, range, today)
  const credit = customerCreditNotes(moves.rows, partner.id)
  const contact = normalizeRecord(row)
  const notes = [
    archived ? 'El cliente está archivado en Odoo.' : null,
    moves.truncated ? 'Odoo devolvió el máximo de facturas abiertas: puede faltar alguna.' : null,
  ].filter(Boolean)

  return {
    cliente: {
      id: `#${partner.id}`,
      nombre: partner.name,
      rfc: partner.vat,
      correo: contact.email ?? null,
      telefono: contact.phone ?? null,
      ciudad: contact.city ?? null,
      pais: contact.country_id ?? null,
    },
    estado_de_cuenta: {
      corte: today,
      rango: rangeLabel(range, (iso) => iso),
      incluye: input.incluir ?? 'ambas',
      total_por_cobrar: statement.totals.total,
      total_vencido: statement.totals.overdue,
      total_por_vencer: statement.totals.upcoming,
      facturas: statement.totals.count,
      monedas_sin_convertir: unconverted(statement.currencies),
      detalle: statement.lines.slice(0, STATEMENT_LIMIT).map(statementLineOut),
      truncado: statement.lines.length > STATEMENT_LIMIT,
    },
    // Customer credit, informed apart: never subtracted from the statement (#102).
    notas_credito_sin_aplicar: {
      total: credit.total,
      documentos: credit.count,
      monedas_sin_convertir: unconverted(credit.currencies),
      ultimas: credit.lines.slice(0, CREDIT_NOTES_LIMIT).map((n) => ({ folio: n.folio, fecha: n.date, saldo: n.residual, moneda: n.currency })),
    },
    cartera_contable: { ...receivableBlock(row), nota: CARTERA_NOTA },
    // Odoo draft/sent are quotations, not sales: the total sums confirmed only, por_estado keeps everything.
    ventas: {
      total_confirmado: ventas
        .filter((g) => CONFIRMED_SALES.has(g.state as string))
        .reduce((sum, g) => sum + ((g.amount_total as number) ?? 0), 0),
      por_estado: ventas,
    },
    facturacion: {
      total_facturado: facturacion.reduce((sum, g) => sum + ((g.amount_total as number) ?? 0), 0),
      total_pendiente: facturacion.reduce((sum, g) => sum + ((g.amount_residual as number) ?? 0), 0),
      por_estado_pago: facturacion,
    },
    nota: notes.length > 0 ? notes.join(' ') : undefined,
  }
}
