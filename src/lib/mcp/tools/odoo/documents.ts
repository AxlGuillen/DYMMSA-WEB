/**
 * Bloque Odoo — Fase 5: detalle de documentos con sus líneas + timbrado CFDI
 * (issue #65, ADR-025). SOLO lectura, mismo contrato que el resto del bloque.
 *
 * Resuelven el folio (F00167 / S00247) → id y filtran las líneas por la FK
 * numérica — el traversal por relación sigue vedado en las primitivas. El
 * timbrado sale de los campos l10n_mx_edi_* (la instancia usa la localización
 * mexicana; verificado 2026-08-13 con la F00167 timbrada y vigente).
 */

import type { OdooCaller } from '@/lib/odoo/client'
import { normalizeRecords } from '@/lib/odoo/normalize'
import { ToolError } from '../../shared'

const LINES_LIMIT = 80

const CFDI_STATE: Record<string, string> = {
  sent: 'timbrada',
  cancel: 'cancelada',
}
// `skip` y `error` solo aparecen en l10n_mx_edi.document (Fase 6).
export const SAT_STATE: Record<string, string> = {
  valid: 'vigente ante el SAT',
  cancelled: 'cancelada ante el SAT',
  not_found: 'no encontrada por el SAT',
  not_defined: 'sin verificar con el SAT',
  skip: 'sin verificación SAT (no aplica)',
  error: 'error al verificar con el SAT',
}

/** Bloque de timbrado digerido; null-safe para facturas sin CFDI. */
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

/**
 * Busca el documento por folio: match exacto (normalizado a mayúsculas) o
 * parcial único; con varias coincidencias devuelve la lista para precisar.
 */
export async function findByFolio(
  odoo: OdooCaller,
  model: string,
  folio: string,
  fields: string[],
): Promise<
  | { found: Record<string, unknown> }
  | { found: null; mensaje: string; coincidencias: unknown[] }
> {
  const query = folio.trim().toUpperCase()
  if (!query) throw new ToolError('Indica el folio del documento (p. ej. F00167 o S00247)')

  const matches = normalizeRecords(
    await odoo(model, 'search_read', {
      domain: [['name', 'ilike', query]],
      fields,
      limit: 5,
      order: 'name asc',
    }),
  )
  const exact = matches.find((m) => m.name === query)
  if (exact) return { found: exact }
  if (matches.length === 1) return { found: matches[0] }
  if (matches.length === 0) {
    return { found: null, mensaje: `Ningún documento coincide con "${query}"`, coincidencias: [] }
  }
  return {
    found: null,
    mensaje: `Hay ${matches.length} folios que coinciden — precisa cuál`,
    coincidencias: matches.map((m) => m.name),
  }
}

// ── odoo_invoice_detail ────────────────────────────────────────────────

const INVOICE_FIELDS = [
  'name', 'partner_id', 'move_type', 'invoice_date', 'invoice_date_due',
  'amount_untaxed', 'amount_total', 'amount_residual', 'payment_state', 'state',
  'invoice_origin', 'l10n_mx_edi_cfdi_uuid', 'l10n_mx_edi_cfdi_state', 'l10n_mx_edi_cfdi_sat_state',
]

export async function odooInvoiceDetail(odoo: OdooCaller, input: { folio: string }) {
  const result = await findByFolio(odoo, 'account.move', input.folio, INVOICE_FIELDS)
  if (!result.found) {
    return { encontrado: false as const, mensaje: result.mensaje, coincidencias: result.coincidencias }
  }
  const header = result.found

  const lines = normalizeRecords(
    await odoo('account.move.line', 'search_read', {
      domain: [['move_id', '=', header.id], ['display_type', '=', 'product']],
      fields: ['name', 'quantity', 'price_unit', 'price_subtotal', 'price_total'],
      limit: LINES_LIMIT,
    }),
  )

  return {
    encontrado: true as const,
    factura: {
      folio: header.name,
      cliente: header.partner_id,
      emitida: header.invoice_date,
      vence: header.invoice_date_due,
      subtotal: header.amount_untaxed,
      total: header.amount_total,
      saldo_pendiente: header.amount_residual,
      estado: header.state,
      estado_pago: header.payment_state,
      origen: header.invoice_origin,
    },
    timbrado: timbrado(header),
    productos: lines.map((l) => ({
      producto: l.name,
      cantidad: l.quantity,
      precio_unitario: l.price_unit,
      subtotal: l.price_subtotal,
      total: l.price_total,
    })),
    nota: lines.length === LINES_LIMIT
      ? `Se listan las primeras ${LINES_LIMIT} líneas — la factura tiene más.`
      : undefined,
  }
}

// ── odoo_sale_detail ───────────────────────────────────────────────────

const SALE_FIELDS = [
  'name', 'partner_id', 'date_order', 'amount_untaxed', 'amount_total',
  'state', 'invoice_status', 'user_id',
]

export async function odooSaleDetail(odoo: OdooCaller, input: { folio: string }) {
  const result = await findByFolio(odoo, 'sale.order', input.folio, SALE_FIELDS)
  if (!result.found) {
    return { encontrado: false as const, mensaje: result.mensaje, coincidencias: result.coincidencias }
  }
  const header = result.found

  const lines = normalizeRecords(
    await odoo('sale.order.line', 'search_read', {
      // Fuera secciones/notas. OJO: aquí display_type es false para líneas
      // normales — el valor 'product' solo existe en account.move.line.
      domain: [['order_id', '=', header.id], ['display_type', '=', false]],
      fields: ['name', 'product_uom_qty', 'qty_delivered', 'qty_invoiced', 'price_unit', 'price_subtotal'],
      limit: LINES_LIMIT,
    }),
  )

  return {
    encontrado: true as const,
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
    productos: lines.map((l) => ({
      producto: l.name,
      pedido: l.product_uom_qty,
      entregado: l.qty_delivered,
      facturado: l.qty_invoiced,
      precio_unitario: l.price_unit,
      subtotal: l.price_subtotal,
    })),
    nota: lines.length === LINES_LIMIT
      ? `Se listan las primeras ${LINES_LIMIT} líneas — la orden tiene más.`
      : undefined,
  }
}
