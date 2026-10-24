/**
 * The whole portfolio (#155, ADR-041): ONE figure, gross per open invoice like the Clientes screen
 * (lib/customers.ts), credit notes apart and never subtracted (#102), currencies summed unconverted
 * but named (ADR-027 §7). Odoo's net ledger figures (#113) live only in odoo_get_customer.
 */

import type { OdooCaller } from '@/lib/odoo/client'
import { fetchCustomersByIds } from '@/lib/odoo/customers'
import { fetchOpenCustomerMoves } from '@/lib/odoo/income'
import { todayIso } from '@/lib/odoo/normalize'
import {
  customersTotals,
  daysLabel,
  statementLines,
  summarizeCustomers,
  type CustomerRow,
  type StatementLine,
  type StatementRange,
} from '@/lib/customers'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50
// Undated lines sort last: they must not take the slots of the most overdue ones.
const NO_DATE = '9999-12-31'

/** Every open invoice, however old or far off. */
const WHOLE_PORTFOLIO: StatementRange = { from: null, to: null, filter: 'all' }

export const RECEIVABLES_ORDER = ['vencido', 'total', 'dias_pago'] as const
export type ReceivablesOrder = (typeof RECEIVABLES_ORDER)[number]

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Odoo's ledger balance for one partner: NET of credit notes and in company currency (#102, #113). */
export function receivableBlock(p: Record<string, unknown>) {
  const dso = num(p.days_sales_outstanding)
  return {
    deuda_total: num(p.total_due),
    vencido: num(p.total_overdue),
    dias_promedio_de_pago: dso === null ? null : Math.round(dso),
  }
}

export const CARTERA_NOTA =
  'Saldo contable de Odoo: neto de notas de crédito y en moneda de la compañía — no lo cuadres contra estado_de_cuenta (bruto por factura) ni le restes notas de crédito otra vez.'

/** One statement line as the Odoo customer tools show it. */
export function statementLineOut(l: StatementLine) {
  return {
    folio: l.folio,
    emitida: l.invoiceDate,
    vence: l.dueDate,
    estado: l.status === 'overdue' ? 'vencida' : 'por vencer',
    dias: daysLabel(l),
    saldo: l.residual,
    total: l.total,
    moneda: l.currency,
  }
}

/** undefined disappears on serialize: currencies are named only when something was summed unconverted. */
export const unconverted = (currencies: readonly string[]) => (currencies.length ? [...currencies] : undefined)

// A customer without Odoo's DSO goes last: "slowest" needs a payment history.
const ORDER: Record<ReceivablesOrder, (a: CustomerRow, b: CustomerRow) => number> = {
  vencido: (a, b) => b.overdue - a.overdue || b.total - a.total,
  total: (a, b) => b.total - a.total || b.overdue - a.overdue,
  dias_pago: (a, b) => (b.daysToPay ?? -1) - (a.daysToPay ?? -1) || b.total - a.total,
}

export interface ListReceivablesInput {
  ordenar?: ReceivablesOrder
  limite?: number
}

export async function odooListReceivables(odoo: OdooCaller, input: ListReceivablesInput = {}) {
  const today = todayIso()
  const ordenar = input.ordenar ?? 'vencido'
  const limite = Math.min(MAX_LIMIT, Math.max(1, Math.floor(input.limite ?? DEFAULT_LIMIT)))

  // 2 calls: every open invoice and credit note, then the DSO of only the customers that owe.
  const moves = await fetchOpenCustomerMoves(odoo)
  const owing = moves.rows.flatMap((m) => (m.moveType === 'out_invoice' && m.customerId !== null ? [m.customerId] : []))
  const customers = owing.length > 0 ? await fetchCustomersByIds(odoo, owing) : []

  const everyone = summarizeCustomers(customers, moves.rows, WHOLE_PORTFOLIO, today)
  const totals = customersTotals(everyone)
  const rows = everyone.filter((r) => r.openInvoices > 0).sort(ORDER[ordenar])
  const oldest = rows
    .flatMap((r) => statementLines(moves.rows, r.id, WHOLE_PORTFOLIO, today).map((l) => ({ ...statementLineOut(l), cliente: r.name })))
    .sort((a, b) => (a.vence ?? NO_DATE).localeCompare(b.vence ?? NO_DATE) || a.folio.localeCompare(b.folio))
  const withCredit = everyone.filter((r) => r.creditNoteCount > 0).sort((a, b) => b.creditNotes - a.creditNotes)

  return {
    corte: today,
    criterio: 'bruto por factura abierta, como la pantalla Clientes; las notas de crédito van aparte y no se restan',
    total_por_cobrar: totals.total,
    total_vencido: totals.overdue,
    total_por_vencer: totals.upcoming,
    facturas: totals.openInvoices,
    clientes_con_saldo: rows.length,
    monedas_sin_convertir: unconverted(totals.currencies),
    ordenado_por: ordenar,
    por_cliente: rows.slice(0, limite).map((r) => ({
      cliente: r.name,
      facturas: r.openInvoices,
      vencido: r.overdue,
      por_vencer: r.upcoming,
      total: r.total,
      dias_promedio_de_pago: r.daysToPay,
      monedas_sin_convertir: unconverted(r.currencies),
    })),
    // Oldest due first across customers; `limite` caps the lists, the totals above cover everything.
    facturas_mas_antiguas: oldest.slice(0, limite),
    notas_credito_sin_aplicar: {
      total: totals.creditNotes,
      documentos: withCredit.reduce((n, r) => n + r.creditNoteCount, 0),
      por_cliente: withCredit.slice(0, limite).map((r) => ({ cliente: r.name, documentos: r.creditNoteCount, saldo_a_favor: r.creditNotes })),
    },
    nota: moves.truncated ? 'Odoo devolvió el máximo de facturas abiertas: puede faltar alguna.' : undefined,
  }
}
