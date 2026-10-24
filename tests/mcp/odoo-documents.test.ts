/** Odoo block, phase 5: document detail + CFDI (#65, ADR-025), behind odoo_get_document since #155.
 *  Real shapes from the instance: F00167 stamped and valid, lines with display_type='product'. */

import { describe, test, expect } from 'vitest'
import { documentTypeOf, odooInvoiceDetail, odooSaleDetail } from '@/lib/mcp/tools/odoo/documents'
import { odooGetDocument } from '@/lib/mcp/tools/odoo/get-document'
import { odooSearchRecords } from '@/lib/mcp/tools/odoo/accounting'
import { ToolError } from '@/lib/mcp/core/errors'
import { fakeOdoo } from '../helpers/fake-odoo'

const F00167 = {
  id: 220,
  name: 'F00167',
  partner_id: [17, 'GE POWER SERVICES MEXICO'],
  move_type: 'out_invoice',
  invoice_date: '2026-05-12',
  invoice_date_due: '2026-08-10',
  amount_untaxed: 154269.24,
  amount_total: 178952.32,
  amount_residual: 178952.32,
  payment_state: 'not_paid',
  state: 'posted',
  invoice_origin: 'S00247',
  l10n_mx_edi_cfdi_uuid: '6063dc3f-b881-4ea9-a24b-d9bb40623340',
  l10n_mx_edi_cfdi_state: 'sent',
  l10n_mx_edi_cfdi_sat_state: 'valid',
  // #110 (captured 2026-09-24): computed count, HTML footer, payment term m2o.
  sale_order_count: 1,
  narration: '<p data-oe-version="2.0">PEDIDO: 4102931264</p>',
  invoice_payment_term_id: [13, '90 días'],
}

const LINE = {
  id: 1294,
  name: '13875 Rodillo para pintar 9 x 3/8" superficies lisas, TRUPER',
  quantity: 15.0,
  product_uom_id: [1, 'Units'],
  price_unit: 56.0,
  price_subtotal: 840.0,
  price_total: 974.4,
  sale_line_ids: [1118],
}

const S00247 = {
  id: 247, name: 'S00247', partner_id: [17, 'GE POWER SERVICES MEXICO'],
  date_order: '2026-05-06 10:00:00', amount_untaxed: 154269.24, amount_total: 178952.32,
  state: 'sale', invoice_status: 'invoiced', user_id: [2, 'Diego Baltazar Esquivel'],
  invoice_ids: [220],
}

describe('catálogo fase 5', () => {
  test('los campos CFDI ya son consultables vía odoo_search_records', async () => {
    const { odoo } = fakeOdoo({ 'account.move.search_read': [[F00167]] })
    const result = await odooSearchRecords(odoo, {
      modelo: 'account.move',
      campos: ['name', 'l10n_mx_edi_cfdi_uuid', 'l10n_mx_edi_cfdi_sat_state'],
      limite: 1,
    })
    expect(result.items[0].l10n_mx_edi_cfdi_uuid).toBe('6063dc3f-b881-4ea9-a24b-d9bb40623340')
  })
})

describe('odoo_get_document', () => {
  test('el prefijo elige el tipo: S… venta, PAY… pago, el resto factura o nota de crédito', () => {
    expect(documentTypeOf('S00247')).toBe('venta')
    expect(documentTypeOf(' s00247 ')).toBe('venta')
    expect(documentTypeOf('PAY00068')).toBe('pago')
    expect(documentTypeOf('F00167')).toBe('factura')
    expect(documentTypeOf('RINV/2026/00012')).toBe('factura')
    // An S not followed by a digit is not a sale folio.
    expect(documentTypeOf('SINV/2026/1')).toBe('factura')
  })

  test('despacha al detalle del modelo que dice el prefijo y lo anuncia en `tipo`', async () => {
    const sale = fakeOdoo({
      'sale.order.search_read': [[S00247]],
      'sale.order.line.search_read': [[]],
      'account.move.search_read': [[{ id: 220, name: 'F00167', move_type: 'out_invoice', state: 'posted', payment_state: 'not_paid', amount_total: 178952.32 }]],
    })
    const venta = await odooGetDocument(sale.odoo, { folio: 'S00247' })
    expect(sale.calls[0].model).toBe('sale.order')
    expect(venta).toMatchObject({ tipo: 'venta', venta: { folio: 'S00247' } })

    const invoice = fakeOdoo({ 'account.move.search_read': [[F00167]], 'account.move.line.search_read': [[LINE]] })
    const factura = await odooGetDocument(invoice.odoo, { folio: 'F00167' })
    expect(invoice.calls[0].model).toBe('account.move')
    expect(factura).toMatchObject({ tipo: 'factura', factura: { folio: 'F00167', documento: 'factura' } })

    const payment = fakeOdoo({ 'account.payment.search_read': [[{ id: 71, name: 'PAY00068', partner_id: [24, 'Andritz'], date: '2026-08-12', amount: 1, payment_type: 'inbound', state: 'paid', memo: false, reconciled_invoice_ids: [] }]] })
    const pago = await odooGetDocument(payment.odoo, { folio: 'pay00068' })
    expect(payment.calls[0].model).toBe('account.payment')
    expect(pago).toMatchObject({ tipo: 'pago', pago: { folio: 'PAY00068', tipo: 'cobro' } })
  })

  test('`tipo` fuerza el modelo cuando el prefijo no lo dice', async () => {
    const { odoo, calls } = fakeOdoo({ 'sale.order.search_read': [[{ ...S00247, name: 'COT-77', invoice_ids: [] }]], 'sale.order.line.search_read': [[]] })
    const result = await odooGetDocument(odoo, { folio: 'COT-77', tipo: 'venta' })
    expect(calls[0].model).toBe('sale.order')
    expect(result.tipo).toBe('venta')
  })

  test('no encontrado o ambiguo → error que dice qué corregir, nunca un éxito vacío', async () => {
    const none = fakeOdoo({ 'account.move.search_read': [[]] })
    const missing = await odooGetDocument(none.odoo, { folio: 'F09999' }).catch((e: unknown) => e)
    expect(missing).toBeInstanceOf(ToolError)
    expect((missing as Error).message).toMatch(/No hay ninguna factura o nota de crédito con el folio "F09999".*tipo: factura \| venta \| pago/)
    const noPayment = fakeOdoo({ 'account.payment.search_read': [[]] })
    await expect(odooGetDocument(noPayment.odoo, { folio: 'PAY09999' })).rejects.toThrow(/^No hay ningún pago con el folio "PAY09999"/)

    const several = fakeOdoo({ 'account.move.search_read': [[{ ...F00167, id: 1, name: 'F00100' }, { ...F00167, id: 2, name: 'F00101' }]] })
    await expect(odooGetDocument(several.odoo, { folio: 'F001' })).rejects.toThrow(/Hay 2 folios de factura o nota de crédito que coinciden con "F001" \(F00100, F00101\)/)
    // No line read for an unresolved folio.
    expect(several.calls).toHaveLength(1)
  })
})

describe('detalle de factura', () => {
  test('folio exacto → encabezado + timbrado digerido + líneas de producto', async () => {
    const { odoo, calls } = fakeOdoo({
      'account.move.search_read': [[F00167]],
      'account.move.line.search_read': [[LINE]],
    })

    const result = await odooInvoiceDetail(odoo, { folio: 'f00167' })

    // Lines are filtered by the numeric FK and only display_type=product.
    expect(calls[1].payload.domain).toEqual([['move_id', '=', 220], ['display_type', '=', 'product']])
    expect(result.factura).toMatchObject({ folio: 'F00167', cliente: 'GE POWER SERVICES MEXICO', total: 178952.32 })
    expect(result.timbrado).toEqual({
      timbrada: true,
      folio_fiscal: '6063dc3f-b881-4ea9-a24b-d9bb40623340',
      estado_cfdi: 'timbrada',
      estado_sat: 'vigente ante el SAT',
    })
    expect(result.productos[0]).toEqual({
      producto: LINE.name,
      cantidad: 15,
      unidad: 'Units',
      precio_unitario: 56,
      subtotal: 840,
      total: 974.4,
      ligada_a_venta: true,
    })
    // #110: the real link, the payment term and the footer notes as text.
    expect(result.factura).toMatchObject({ termino_pago: '90 días', notas_pie: 'PEDIDO: 4102931264' })
    expect(result.vinculo_venta).toEqual({ ordenes_ligadas: 1, diagnostico: 'ligada' })
  })

  test('una nota de crédito sale como tal', async () => {
    const { odoo } = fakeOdoo({
      'account.move.search_read': [[{ ...F00167, name: 'RINV/2026/00012', move_type: 'out_refund' }]],
      'account.move.line.search_read': [[]],
    })
    const result = await odooInvoiceDetail(odoo, { folio: 'RINV/2026/00012' })
    expect(result.factura.documento).toBe('nota de crédito')
  })

  test('huérfana: 0 órdenes ligadas sin origen; con origen es vínculo roto (#110)', async () => {
    const orphan = { ...F00167, name: 'F00471', sale_order_count: 0, invoice_origin: false, narration: false, invoice_payment_term_id: false }
    const { odoo } = fakeOdoo({
      'account.move.search_read': [[orphan], [{ ...orphan, invoice_origin: 'S00247' }]],
      'account.move.line.search_read': [[{ ...LINE, sale_line_ids: [] }], []],
    })
    const a = await odooInvoiceDetail(odoo, { folio: 'F00471' })
    expect(a.vinculo_venta).toEqual({ ordenes_ligadas: 0, diagnostico: 'huerfana' })
    expect(a.factura).toMatchObject({ termino_pago: null, notas_pie: null })
    expect(a.productos[0].ligada_a_venta).toBe(false)

    const b = await odooInvoiceDetail(odoo, { folio: 'F00471' })
    expect(b.vinculo_venta.diagnostico).toBe('vinculo_roto')
    expect(b.productos).toEqual([])
  })

  test('sin CFDI → timbrada: false con detalle (Odoo manda false, no null)', async () => {
    const { odoo } = fakeOdoo({
      'account.move.search_read': [[{ ...F00167, l10n_mx_edi_cfdi_uuid: false, l10n_mx_edi_cfdi_state: false, l10n_mx_edi_cfdi_sat_state: false }]],
      'account.move.line.search_read': [[]],
    })
    const result = await odooInvoiceDetail(odoo, { folio: 'F00167' })
    expect(result.timbrado).toEqual({ timbrada: false, detalle: 'Sin CFDI: la factura no está timbrada.' })
  })
})

describe('detalle de venta', () => {
  test('venta con líneas pedido/entregado/facturado — el corazón del seguimiento', async () => {
    const { odoo, calls } = fakeOdoo({
      'sale.order.search_read': [[S00247]],
      'sale.order.line.search_read': [[{
        id: 1118, name: LINE.name, product_uom_qty: 15, product_uom_id: [1, 'Units'], qty_delivered: 15, qty_invoiced: 15,
        qty_to_invoice: 0, price_unit: 56, price_subtotal: 840, invoice_lines: [1294],
      }]],
      'account.move.search_read': [[{ id: 220, name: 'F00167', move_type: 'out_invoice', state: 'posted', payment_state: 'not_paid', amount_total: 178952.32 }]],
    })

    const result = await odooSaleDetail(odoo, { folio: 'S00247' })

    // display_type=false (not 'product': that value only exists in
    // account.move.line) drops sections and notes from the order.
    expect(calls[1].payload.domain).toEqual([['order_id', '=', 247], ['display_type', '=', false]])
    // #110: the invoices come from the computed invoice_ids, resolved by id in one more call.
    expect(calls[2].payload.domain).toEqual([['id', 'in', [220]]])
    expect(result.venta).toMatchObject({ folio: 'S00247', vendedor: 'Diego Baltazar Esquivel', estado: 'sale' })
    expect(result.facturas).toEqual([{ folio: 'F00167', tipo: 'factura', estado: 'posted', estado_pago: 'not_paid', total: 178952.32 }])
    expect(result.productos[0]).toMatchObject({ pedido: 15, unidad: 'Units', entregado: 15, facturado: 15, por_facturar: 0, lineas_de_factura: 1 })
  })

  test('venta sin facturas: sin la llamada extra, facturas vacías y por_facturar > 0 (#110)', async () => {
    const { odoo, calls } = fakeOdoo({
      'sale.order.search_read': [[{ id: 779, name: 'S00779', partner_id: [17, 'X'], date_order: '2026-09-20 10:00:00', amount_untaxed: 1, amount_total: 1, state: 'sale', invoice_status: 'to invoice', user_id: false, invoice_ids: [] }]],
      'sale.order.line.search_read': [[{ id: 1, name: 'x', product_uom_qty: 4, product_uom_id: [2, 'Cajas'], qty_delivered: 4, qty_invoiced: 0, qty_to_invoice: 4, price_unit: 1, price_subtotal: 4, invoice_lines: [] }]],
    })
    const result = await odooSaleDetail(odoo, { folio: 'S00779' })
    expect(calls).toHaveLength(2)
    expect(result.facturas).toEqual([])
    expect(result.productos[0]).toMatchObject({ unidad: 'Cajas', por_facturar: 4, lineas_de_factura: 0 })
  })

  test('factura en borrador ligada: sin folio (false o "/") se etiqueta; ids no numéricos no llegan al dominio', async () => {
    const { odoo, calls } = fakeOdoo({
      'sale.order.search_read': [[{ id: 739, name: 'S00739', partner_id: [24, 'Andritz'], date_order: '2026-09-24 17:29:55', amount_untaxed: 1, amount_total: 1, state: 'sale', invoice_status: 'invoiced', user_id: false, invoice_ids: [1043, 'x', 1044] }]],
      'sale.order.line.search_read': [[]],
      'account.move.search_read': [[
        { id: 1043, name: false, move_type: 'out_invoice', state: 'draft', payment_state: 'not_paid', amount_total: 1 },
        { id: 1044, name: '/', move_type: 'out_refund', state: 'draft', payment_state: 'not_paid', amount_total: 1 },
      ]],
    })
    const result = await odooSaleDetail(odoo, { folio: 'S00739' })
    expect(calls[2].payload.domain).toEqual([['id', 'in', [1043, 1044]]])
    expect(result.facturas.map((f) => [f.folio, f.tipo])).toEqual([['(borrador, sin folio)', 'factura'], ['(borrador, sin folio)', 'nota de crédito']])
  })
})
