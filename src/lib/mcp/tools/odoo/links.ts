/**
 * Odoo phase 7 (#110): the REAL invoice ↔ sale order link. `sale_order_count` is the "Sale
 * Orders" button of the invoice — computed, not stored, so it cannot be filtered: the tool reads
 * the period page by page and filters in memory. `invoice_origin` is free text and stays a hint.
 */

import type { OdooCaller } from '@/lib/odoo/client'
import type { DomainTriple } from '@/lib/odoo/catalog'
import { htmlToText, normalizeRecords, todayIso } from '@/lib/odoo/normalize'
import { ToolError } from '../../shared'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Bigger pages = fewer calls against the 1.1 s queue; the cap keeps a runaway period bounded.
const PAGE = 200
const MAX_PAGES = 10
const DEFAULT_DAYS = 30

export type LinkDiagnosis = 'ligada' | 'vinculo_roto' | 'huerfana'

/** ligada: at least one order linked. vinculo_roto: the origin text names one but nothing is linked. huerfana: neither. */
export function linkDiagnosis(saleOrderCount: unknown, origin: unknown): LinkDiagnosis {
  if (typeof saleOrderCount === 'number' && saleOrderCount > 0) return 'ligada'
  return typeof origin === 'string' && origin.trim() ? 'vinculo_roto' : 'huerfana'
}

const DIAGNOSIS_TEXT: Record<LinkDiagnosis, string> = {
  ligada: 'ligada a una orden de venta',
  vinculo_roto: 'el origen menciona una orden pero ninguna está ligada — vínculo roto',
  huerfana: 'sin orden de venta ligada ni origen — huérfana',
}

function daysAgo(days: number, today: string): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

export interface InvoiceLinkCheckInput {
  /** YYYY-MM-DD over invoice_date; default = 30 days ago. */
  date_from?: string
  /** YYYY-MM-DD; default = today. */
  date_to?: string
  /** Partial customer name. */
  cliente?: string
  /** Also list the linked invoices (default: only the problematic ones). */
  incluir_ligadas?: boolean
}

const FIELDS = [
  'name', 'partner_id', 'invoice_date', 'amount_total', 'sale_order_count',
  'invoice_origin', 'narration', 'invoice_payment_term_id',
]

export async function odooInvoiceLinkCheck(odoo: OdooCaller, input: InvoiceLinkCheckInput = {}) {
  for (const date of [input.date_from, input.date_to]) {
    if (date && !DATE_RE.test(date)) throw new ToolError(`Fecha inválida "${date}" — usa YYYY-MM-DD`)
  }
  const today = todayIso()
  const from = input.date_from ?? daysAgo(DEFAULT_DAYS, today)
  const to = input.date_to ?? today
  const cliente = input.cliente?.trim()

  const domain: DomainTriple[] = [
    ['move_type', '=', 'out_invoice'],
    ['state', '=', 'posted'],
    ['invoice_date', '>=', from],
    ['invoice_date', '<=', to],
    ...(cliente ? [['partner_id', 'ilike', cliente] as DomainTriple] : []),
  ]

  const invoices: Record<string, unknown>[] = []
  let pages = 0
  let truncated = false
  for (;;) {
    const page = normalizeRecords(
      await odoo('account.move', 'search_read', {
        domain,
        fields: FIELDS,
        limit: PAGE,
        offset: pages * PAGE,
        order: 'invoice_date asc, name asc',
      }),
    )
    pages += 1
    invoices.push(...page)
    if (page.length < PAGE) break
    if (pages >= MAX_PAGES) {
      truncated = true
      break
    }
  }

  const digested = invoices.map((inv) => {
    const diagnostico = linkDiagnosis(inv.sale_order_count, inv.invoice_origin)
    return {
      folio: inv.name,
      cliente: inv.partner_id,
      fecha: inv.invoice_date,
      total: inv.amount_total,
      ordenes_ligadas: inv.sale_order_count,
      origen: inv.invoice_origin,
      pedido_pie: htmlToText(inv.narration),
      termino_pago: inv.invoice_payment_term_id,
      diagnostico,
      detalle: DIAGNOSIS_TEXT[diagnostico],
    }
  })
  const huerfanas = digested.filter((d) => d.diagnostico === 'huerfana')
  const rotas = digested.filter((d) => d.diagnostico === 'vinculo_roto')

  return {
    periodo: { desde: from, hasta: to },
    cliente: cliente ?? null,
    revisadas: digested.length,
    ligadas: digested.length - huerfanas.length - rotas.length,
    huerfanas,
    vinculos_rotos: rotas,
    ...(input.incluir_ligadas ? { ligadas_detalle: digested.filter((d) => d.diagnostico === 'ligada') } : {}),
    llamadas: pages,
    nota: truncated
      ? `Revisión truncada a ${PAGE * MAX_PAGES} facturas: acota el periodo o filtra por cliente.`
      : null,
  }
}
