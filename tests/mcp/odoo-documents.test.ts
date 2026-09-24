/** Odoo block, phase 5: document detail + CFDI (#65, ADR-025). Real shapes from
 *  the instance: F00167 stamped and valid, lines with display_type='product'. */

import { describe, test, expect } from 'vitest'
import type { OdooCaller } from '@/lib/odoo/client'
import { odooInvoiceDetail, odooSaleDetail } from '@/lib/mcp/tools/odoo/documents'
import { odooQuery } from '@/lib/mcp/tools/odoo/accounting'

type Call = { model: string; method: string; payload: Record<string, unknown> }

function fakeOdoo(script: Record<string, unknown[]>) {
  const calls: Call[] = []
  const pending = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]))
  const odoo: OdooCaller = async (model, method, payload) => {
    calls.push({ model, method, payload })
    const key = `${model}.${method}`
    const queue = pending[key]
    if (!queue || queue.length === 0) throw new Error(`sin respuesta programada para ${key}`)
    return queue.shift()
  }
  return { odoo, calls }
}

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

describe('catálogo fase 5', () => {
  test('los campos CFDI ya son consultables vía odoo_query', async () => {
    const { odoo } = fakeOdoo({ 'account.move.search_read': [[F00167]] })
    const result = await odooQuery(odoo, {
      model: 'account.move',
      fields: ['name', 'l10n_mx_edi_cfdi_uuid', 'l10n_mx_edi_cfdi_sat_state'],
      limit: 1,
    })
    expect(result.items[0].l10n_mx_edi_cfdi_uuid).toBe('6063dc3f-b881-4ea9-a24b-d9bb40623340')
  })
})

describe('odoo_invoice_detail', () => {
  test('folio exacto → encabezado + timbrado digerido + líneas de producto', async () => {
    const { odoo, calls } = fakeOdoo({
      'account.move.search_read': [[F00167]],
      'account.move.line.search_read': [[LINE]],
    })

    const result = await odooInvoiceDetail(odoo, { folio: 'f00167' })

    // Lines are filtered by the numeric FK and only display_type=product.
    expect(calls[1].payload.domain).toEqual([['move_id', '=', 220], ['display_type', '=', 'product']])
    expect(result.encontrado).toBe(true)
    if (result.encontrado) {
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
    }
  })

  test('huérfana: 0 órdenes ligadas sin origen; con origen es vínculo roto (#110)', async () => {
    const orphan = { ...F00167, name: 'F00471', sale_order_count: 0, invoice_origin: false, narration: false, invoice_payment_term_id: false }
    const { odoo } = fakeOdoo({
      'account.move.search_read': [[orphan], [{ ...orphan, invoice_origin: 'S00247' }]],
      'account.move.line.search_read': [[{ ...LINE, sale_line_ids: [] }], [[]]],
    })
    const a = await odooInvoiceDetail(odoo, { folio: 'F00471' })
    if (a.encontrado) {
      expect(a.vinculo_venta).toEqual({ ordenes_ligadas: 0, diagnostico: 'huerfana' })
      expect(a.factura).toMatchObject({ termino_pago: null, notas_pie: null })
      expect(a.productos[0].ligada_a_venta).toBe(false)
    }
    const b = await odooInvoiceDetail(odoo, { folio: 'F00471' })
    if (b.encontrado) expect(b.vinculo_venta.diagnostico).toBe('vinculo_roto')
  })

  test('sin CFDI → timbrada: false con detalle (Odoo manda false, no null)', async () => {
    const { odoo } = fakeOdoo({
      'account.move.search_read': [[{ ...F00167, l10n_mx_edi_cfdi_uuid: false, l10n_mx_edi_cfdi_state: false, l10n_mx_edi_cfdi_sat_state: false }]],
      'account.move.line.search_read': [[]],
    })
    const result = await odooInvoiceDetail(odoo, { folio: 'F00167' })
    if (result.encontrado) {
      expect(result.timbrado).toEqual({ timbrada: false, detalle: 'Sin CFDI: la factura no está timbrada.' })
    }
  })

  test('folio parcial con varias coincidencias → lista para precisar, sin pedir líneas', async () => {
    const { odoo, calls } = fakeOdoo({
      'account.move.search_read': [[
        { ...F00167, id: 1, name: 'F00100' },
        { ...F00167, id: 2, name: 'F00101' },
      ]],
    })
    const result = await odooInvoiceDetail(odoo, { folio: 'F001' })
    expect(result.encontrado).toBe(false)
    if (!result.encontrado) expect(result.coincidencias).toEqual(['F00100', 'F00101'])
    expect(calls).toHaveLength(1)
  })
})

describe('odoo_sale_detail', () => {
  test('venta con líneas pedido/entregado/facturado — el corazón del seguimiento', async () => {
    const { odoo, calls } = fakeOdoo({
      'sale.order.search_read': [[{
        id: 247, name: 'S00247', partner_id: [17, 'GE POWER SERVICES MEXICO'],
        date_order: '2026-05-06 10:00:00', amount_untaxed: 154269.24, amount_total: 178952.32,
        state: 'sale', invoice_status: 'invoiced', user_id: [2, 'Diego Baltazar Esquivel'],
        invoice_ids: [220],
      }]],
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
    expect(result.encontrado).toBe(true)
    if (result.encontrado) {
      expect(result.venta).toMatchObject({ folio: 'S00247', vendedor: 'Diego Baltazar Esquivel', estado: 'sale' })
      expect(result.facturas).toEqual([{ folio: 'F00167', tipo: 'factura', estado: 'posted', estado_pago: 'not_paid', total: 178952.32 }])
      expect(result.productos[0]).toMatchObject({ pedido: 15, unidad: 'Units', entregado: 15, facturado: 15, por_facturar: 0, lineas_de_factura: 1 })
    }
  })

  test('venta sin facturas: sin la llamada extra, facturas vacías y por_facturar > 0 (#110)', async () => {
    const { odoo, calls } = fakeOdoo({
      'sale.order.search_read': [[{ id: 779, name: 'S00779', partner_id: [17, 'X'], date_order: '2026-09-20 10:00:00', amount_untaxed: 1, amount_total: 1, state: 'sale', invoice_status: 'to invoice', user_id: false, invoice_ids: [] }]],
      'sale.order.line.search_read': [[{ id: 1, name: 'x', product_uom_qty: 4, product_uom_id: [2, 'Cajas'], qty_delivered: 4, qty_invoiced: 0, qty_to_invoice: 4, price_unit: 1, price_subtotal: 4, invoice_lines: [] }]],
    })
    const result = await odooSaleDetail(odoo, { folio: 'S00779' })
    expect(calls).toHaveLength(2)
    if (result.encontrado) {
      expect(result.facturas).toEqual([])
      expect(result.productos[0]).toMatchObject({ unidad: 'Cajas', por_facturar: 4, lineas_de_factura: 0 })
    }
  })
})
