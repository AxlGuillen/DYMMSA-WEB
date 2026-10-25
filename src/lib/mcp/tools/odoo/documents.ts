/** Odoo phase 5 — document detail + CFDI stamping (ADR-025): folio → id, lines by numeric FK (traversal stays banned in the primitives). */

import type { OdooCaller } from '@/lib/odoo/client'
import { escapeLike } from '@/lib/odoo/domains'
import { htmlToText, idsOf, normalizeRecords } from '@/lib/odoo/normalize'
import { ToolError } from '@/lib/mcp/core/errors'
import { linkDiagnosis } from './links'

const LINES_LIMIT = 80
const INVOICES_LIMIT = 50

const CFDI_STATE: Record<string, string> = {
  sent: 'timbrada',
  cancel: 'cancelada',
}
// `skip` and `error` only show up on l10n_mx_edi.document (phase 6).
export const SAT_STATE: Record<string, string> = {
  valid: 'vigente ante el SAT',
  cancelled: 'cancelada ante el SAT',
  not_found: 'no encontrada por el SAT',
  not_defined: 'sin verificar con el SAT',
  skip: 'sin verificación SAT (no aplica)',
  error: 'error al verificar con el SAT',
}

/** Digested stamping block; null-safe for invoices with no CFDI. */
export function timbrado(header: Record<string, unknown>) {
  const uuid = header.l10n_mx_edi_cfdi_uuid
  if (typeof uuid !== 'string' || !uuid) {
    return { timbrada: false as const, detalle: 'Sin CFDI: la factura no está timbrada.' }
  }
  const cfdi = header.l10n_mx_edi_cfdi_state
  const sat = header.l10n_mx_edi_cfdi_sat_state
  return {
    timbrada: true as const,
    folio_fiscal: uuid,
    estado_cfdi: (typeof cfdi === 'string' && CFDI_STATE[cfdi]) || cfdi || null,
    estado_sat: (typeof sat === 'string' && SAT_STATE[sat]) || sat || null,
  }
}

export const DOCUMENT_TYPES = ['factura', 'venta', 'pago'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

const DOCUMENT_LABEL: Record<DocumentType, { what: string; none: string }> = {
  factura: { what: 'factura o nota de crédito', none: 'ninguna factura o nota de crédito' },
  venta: { what: 'venta', none: 'ninguna venta' },
  pago: { what: 'pago', none: 'ningún pago' },
}

/** The folio's prefix picks the model (#155): S… sale or quotation, PAY… payment, the rest account.move. */
export function documentTypeOf(folio: string): DocumentType {
  const name = folio.trim().toUpperCase()
  if (name.startsWith('PAY')) return 'pago'
  if (/^S\d/.test(name)) return 'venta'
  return 'factura'
}

/** Exact (upper-cased) or unique partial folio match; none or several are errors that say what to fix (#155). */
export async function findByFolio(
  odoo: OdooCaller,
  type: DocumentType,
  model: string,
  folio: string,
  fields: string[],
): Promise<Record<string, unknown>> {
  const query = folio.trim().toUpperCase()
  if (!query) throw new ToolError('Indica el folio del documento (p. ej. F00167, S00247 o PAY00068)')

  const matches = normalizeRecords(
    await odoo(model, 'search_read', {
      domain: [['name', 'ilike', escapeLike(query)]],
      fields,
      limit: 5,
      order: 'name asc',
    }),
  )
  const exact = matches.find((m) => m.name === query)
  if (exact) return exact
  if (matches.length === 1) return matches[0]
  const label = DOCUMENT_LABEL[type]
  if (matches.length === 0) {
    // The prefix may have picked the wrong model: say how to force it.
    throw new ToolError(`No hay ${label.none} con el folio "${query}" en Odoo. Revisa el folio completo (p. ej. F00167); si es de otro tipo, pásalo con tipo: factura | venta | pago.`)
  }
  throw new ToolError(`Hay ${matches.length} folios de ${label.what} que coinciden con "${query}" (${matches.map((m) => m.name).join(', ')}): pásame el folio completo.`)
}

/** x2many fields arrive as id arrays; the model only needs how many. */
const idCount = (value: unknown) => idsOf(value).length

const INVOICE_FIELDS = [
  'name', 'partner_id', 'move_type', 'invoice_date', 'invoice_date_due',
  'amount_untaxed', 'amount_total', 'amount_residual', 'payment_state', 'state',
  'invoice_origin', 'l10n_mx_edi_cfdi_uuid', 'l10n_mx_edi_cfdi_state', 'l10n_mx_edi_cfdi_sat_state',
  // #110: real sale link, footer notes and payment term.
  'sale_order_count', 'narration', 'invoice_payment_term_id',
]

export async function odooInvoiceDetail(odoo: OdooCaller, input: { folio: string }) {
  const header = await findByFolio(odoo, 'factura', 'account.move', input.folio, INVOICE_FIELDS)

  const lines = normalizeRecords(
    await odoo('account.move.line', 'search_read', {
      domain: [['move_id', '=', header.id], ['display_type', '=', 'product']],
      fields: ['name', 'quantity', 'product_uom_id', 'price_unit', 'price_subtotal', 'price_total', 'sale_line_ids'],
      limit: LINES_LIMIT,
    }),
  )

  return {
    factura: {
      folio: header.name,
      documento: header.move_type === 'out_refund' ? 'nota de crédito' : 'factura',
      cliente: header.partner_id,
      emitida: header.invoice_date,
      vence: header.invoice_date_due,
      termino_pago: header.invoice_payment_term_id,
      subtotal: header.amount_untaxed,
      total: header.amount_total,
      saldo_pendiente: header.amount_residual,
      estado: header.state,
      estado_pago: header.payment_state,
      origen: header.invoice_origin,
      notas_pie: htmlToText(header.narration),
    },
    vinculo_venta: {
      ordenes_ligadas: header.sale_order_count,
      diagnostico: linkDiagnosis(header.sale_order_count, header.invoice_origin),
    },
    timbrado: timbrado(header),
    productos: lines.map((l) => ({
      producto: l.name,
      cantidad: l.quantity,
      unidad: l.product_uom_id,
      precio_unitario: l.price_unit,
      subtotal: l.price_subtotal,
      total: l.price_total,
      ligada_a_venta: idCount(l.sale_line_ids) > 0,
    })),
    nota: lines.length === LINES_LIMIT
      ? `Se listan las primeras ${LINES_LIMIT} líneas — la factura tiene más.`
      : undefined,
  }
}

const SALE_FIELDS = [
  'name', 'partner_id', 'date_order', 'amount_untaxed', 'amount_total',
  'state', 'invoice_status', 'user_id', 'invoice_ids',
]

export async function odooSaleDetail(odoo: OdooCaller, input: { folio: string }) {
  const header = await findByFolio(odoo, 'venta', 'sale.order', input.folio, SALE_FIELDS)

  const lines = normalizeRecords(
    await odoo('sale.order.line', 'search_read', {
      // Drop sections/notes. NOTE: display_type is false for normal lines here —
      // 'product' only exists in account.move.line.
      domain: [['order_id', '=', header.id], ['display_type', '=', false]],
      fields: ['name', 'product_uom_qty', 'product_uom_id', 'qty_delivered', 'qty_invoiced', 'qty_to_invoice', 'price_unit', 'price_subtotal', 'invoice_lines'],
      limit: LINES_LIMIT,
    }),
  )

  // invoice_ids is computed (not stored): read per record, then one call resolves the folios.
  const invoiceIds = idsOf(header.invoice_ids)
  const facturas = invoiceIds.length
    ? normalizeRecords(
        await odoo('account.move', 'search_read', {
          domain: [['id', 'in', invoiceIds]],
          fields: ['name', 'move_type', 'state', 'payment_state', 'amount_total'],
          limit: INVOICES_LIMIT,
          order: 'name asc',
        }),
      ).map((f) => ({
        // A draft invoice has no folio yet (Odoo returns false or '/'): say so instead of null.
        folio: !f.name || f.name === '/' ? '(borrador, sin folio)' : f.name,
        tipo: f.move_type === 'out_refund' ? 'nota de crédito' : 'factura',
        estado: f.state,
        estado_pago: f.payment_state,
        total: f.amount_total,
      }))
    : []

  return {
    venta: {
      folio: header.name,
      cliente: header.partner_id,
      fecha: header.date_order,
      subtotal: header.amount_untaxed,
      total: header.amount_total,
      estado: header.state,
      estado_facturacion: header.invoice_status,
      vendedor: header.user_id,
    },
    facturas,
    productos: lines.map((l) => ({
      producto: l.name,
      pedido: l.product_uom_qty,
      unidad: l.product_uom_id,
      entregado: l.qty_delivered,
      facturado: l.qty_invoiced,
      por_facturar: l.qty_to_invoice,
      lineas_de_factura: idCount(l.invoice_lines),
      precio_unitario: l.price_unit,
      subtotal: l.price_subtotal,
    })),
    nota:
      [
        lines.length === LINES_LIMIT ? `Se listan las primeras ${LINES_LIMIT} líneas — la orden tiene más.` : null,
        invoiceIds.length > INVOICES_LIMIT ? `Se listan ${INVOICES_LIMIT} de ${invoiceIds.length} facturas ligadas.` : null,
      ]
        .filter(Boolean)
        .join(' ') || undefined,
  }
}
