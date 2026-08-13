/**
 * Tools del bloque Odoo — Fase 5: detalle de documentos + CFDI (issue #65,
 * ADR-025). Formas reales de la instancia (2026-08-13): F00167 timbrada y
 * vigente, líneas con display_type='product', sale.order.line con qty_*.
 */

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
}

const LINE = {
  id: 1294,
  name: '13875 Rodillo para pintar 9 x 3/8" superficies lisas, TRUPER',
  quantity: 15.0,
  price_unit: 56.0,
  price_subtotal: 840.0,
  price_total: 974.4,
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

    // Las líneas se filtran por la FK numérica y solo display_type=product.
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
        precio_unitario: 56,
        subtotal: 840,
        total: 974.4,
      })
    }
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
      }]],
      'sale.order.line.search_read': [[{
        id: 1118, name: LINE.name, product_uom_qty: 15, qty_delivered: 15, qty_invoiced: 15,
        price_unit: 56, price_subtotal: 840,
      }]],
    })

    const result = await odooSaleDetail(odoo, { folio: 'S00247' })

    expect(calls[1].payload.domain).toEqual([['order_id', '=', 247]])
    expect(result.encontrado).toBe(true)
    if (result.encontrado) {
      expect(result.venta).toMatchObject({ folio: 'S00247', vendedor: 'Diego Baltazar Esquivel', estado: 'sale' })
      expect(result.productos[0]).toMatchObject({ pedido: 15, entregado: 15, facturado: 15 })
    }
  })
})
