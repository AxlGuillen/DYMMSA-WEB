/** Odoo block, phase 7 (#110): the real invoice ↔ sale order link. Shapes captured from the
 *  instance on 2026-09-24: sale_order_count per record, narration as HTML, payment term m2o. */

import { describe, test, expect } from 'vitest'
import type { OdooCaller } from '@/lib/odoo/client'
import { odooInvoiceLinkCheck, linkDiagnosis } from '@/lib/mcp/tools/odoo/links'
import { odooQuery } from '@/lib/mcp/tools/odoo/accounting'
import { htmlToText } from '@/lib/odoo/normalize'

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

const invoice = (id: number, name: string, count: number, origin: string | false, narration: string | false = false) => ({
  id, name, partner_id: [17, 'GE POWER SERVICES MEXICO'], invoice_date: '2026-09-23', amount_total: 1000 + id,
  sale_order_count: count, invoice_origin: origin, narration, invoice_payment_term_id: [13, '90 días'],
})

describe('linkDiagnosis', () => {
  test('ligada / vínculo roto / huérfana según conteo real y origen', () => {
    expect(linkDiagnosis(1, 'S00713')).toBe('ligada')
    expect(linkDiagnosis(0, 'S00713')).toBe('vinculo_roto')
    expect(linkDiagnosis(0, false)).toBe('huerfana')
    expect(linkDiagnosis(0, '  ')).toBe('huerfana')
    // The count is computed and version-dependent: no number = no verdict, never a false "huérfana".
    expect(linkDiagnosis(null, null)).toBe('desconocido')
    expect(linkDiagnosis(undefined, 'S00713')).toBe('desconocido')
  })
})

describe('htmlToText', () => {
  test('quita el envoltorio de Odoo y decodifica entidades; vacío → null', () => {
    expect(htmlToText('<p data-oe-version="2.0">PEDIDO: 4102931264</p>')).toBe('PEDIDO: 4102931264')
    expect(htmlToText('<div>PEDIDO: 4900654441</div><div>RC: 1180737</div>')).toBe('PEDIDO: 4900654441\nRC: 1180737')
    expect(htmlToText("<p>AT'N &amp; CIA &lt;3</p>")).toBe("AT'N & CIA <3")
    expect(htmlToText('<p><br></p>')).toBeNull()
    expect(htmlToText(false)).toBeNull()
  })
})

describe('odoo_invoice_link_check', () => {
  test('clasifica las del periodo y solo devuelve las problemáticas; una llamada si cabe en una página', async () => {
    const { odoo, calls } = fakeOdoo({
      'account.move.search_read': [[
        invoice(1041, 'F00522', 1, 'S00713', '<p data-oe-version="2.0">PEDIDO: 4102931264</p>'),
        invoice(943, 'F00471', 0, false),
        invoice(950, 'F00480', 0, 'S00650', '<p>PEDIDO: 77</p>'),
      ]],
    })
    const result = await odooInvoiceLinkCheck(odoo, { date_from: '2026-09-01', date_to: '2026-09-30' })

    expect(calls).toHaveLength(1)
    expect(calls[0].payload.domain).toEqual([
      ['move_type', '=', 'out_invoice'], ['state', '=', 'posted'],
      ['invoice_date', '>=', '2026-09-01'], ['invoice_date', '<=', '2026-09-30'],
    ])
    expect(calls[0].payload).toMatchObject({ limit: 200, offset: 0 })
    expect(result).toMatchObject({ periodo: { desde: '2026-09-01', hasta: '2026-09-30' }, revisadas: 3, ligadas: 1, llamadas: 1, nota: null })
    // Without a customer filter the list would be every customer of the period: only emitted with `cliente`.
    expect('clientes_encontrados' in result).toBe(false)
    expect('sin_diagnostico' in result).toBe(false)
    expect(result.huerfanas).toEqual([expect.objectContaining({ folio: 'F00471', diagnostico: 'huerfana', origen: null, pedido_pie: null })])
    expect(result.vinculos_rotos).toEqual([
      expect.objectContaining({ folio: 'F00480', diagnostico: 'vinculo_roto', origen: 'S00650', pedido_pie: 'PEDIDO: 77', termino_pago: '90 días' }),
    ])
    expect('ligadas_detalle' in result).toBe(false)
  })

  test('pagina por encima del tope (200) y acumula; incluir_ligadas lista también las correctas', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => invoice(i + 1, `F${String(i + 1).padStart(5, '0')}`, 1, `S${i}`))
    const page2 = [invoice(999, 'F00999', 0, false)]
    const { odoo, calls } = fakeOdoo({ 'account.move.search_read': [page1, page2] })
    const result = await odooInvoiceLinkCheck(odoo, { date_from: '2026-01-01', date_to: '2026-09-30', incluir_ligadas: true })

    expect(calls.map((c) => c.payload.offset)).toEqual([0, 200])
    expect(result).toMatchObject({ revisadas: 201, ligadas: 200, llamadas: 2 })
    expect(result.huerfanas.map((h) => h.folio)).toEqual(['F00999'])
    expect(result.ligadas_detalle).toHaveLength(200)
  })

  test('cliente acota por partner_id ilike; default = últimos 30 días; fecha inválida o rango invertido → error', async () => {
    const { odoo, calls } = fakeOdoo({ 'account.move.search_read': [[]] })
    const result = await odooInvoiceLinkCheck(odoo, { cliente: 'GE' })
    expect(calls[0].payload.domain).toContainEqual(['partner_id', 'ilike', 'GE'])
    const [from, to] = [result.periodo.desde, result.periodo.hasta]
    expect(Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)).toBe(30)
    expect(result.cliente).toBe('GE')
    expect(result.clientes_encontrados).toEqual([])

    await expect(odooInvoiceLinkCheck(odoo, { date_from: '01/09/2026' })).rejects.toThrow(/Fecha inválida/)
    // An inverted range would come back as "0 huérfanas" and read as all good (review PR #116).
    await expect(odooInvoiceLinkCheck(odoo, { date_from: '2026-09-30', date_to: '2026-09-01' })).rejects.toThrow(/Rango invertido/)
    expect(calls).toHaveLength(1)
  })

  test('tope de páginas: una llamada de conteo decide si de verdad faltó algo (sin falso "truncada" en múltiplos exactos)', async () => {
    const fullPage = (offset: number) => Array.from({ length: 200 }, (_, i) => invoice(offset + i + 1, `F${offset + i + 1}`, 1, 'S1'))
    const pages = Array.from({ length: 10 }, (_, p) => fullPage(p * 200))

    const exact = fakeOdoo({ 'account.move.search_read': pages, 'account.move.search_count': [2000] })
    const a = await odooInvoiceLinkCheck(exact.odoo, { date_from: '2026-01-01', date_to: '2026-12-31' })
    expect(a).toMatchObject({ revisadas: 2000, llamadas: 11, nota: null })

    const more = fakeOdoo({ 'account.move.search_read': pages, 'account.move.search_count': [2350] })
    const b = await odooInvoiceLinkCheck(more.odoo, { date_from: '2026-01-01', date_to: '2026-12-31' })
    expect(b.nota).toMatch(/2000 facturas leídas de 2350/)

    // A weird count must still say "truncated", never read as a complete period (re-review PR #116).
    const odd = fakeOdoo({ 'account.move.search_read': pages, 'account.move.search_count': [{ unexpected: true }] })
    const c = await odooInvoiceLinkCheck(odd.odoo, { date_from: '2026-01-01', date_to: '2026-12-31' })
    expect(c.nota).toMatch(/Revisión truncada: 2000 facturas leídas del periodo/)
  })

  test('sin sale_order_count en la respuesta → sin_diagnostico aparte, nunca huérfana', async () => {
    const { odoo } = fakeOdoo({ 'account.move.search_read': [[{ ...invoice(1, 'F1', 0, false), sale_order_count: undefined }]] })
    const result = await odooInvoiceLinkCheck(odoo, { date_from: '2026-09-01', date_to: '2026-09-30' })
    expect(result.huerfanas).toEqual([])
    expect(result.sin_diagnostico?.map((d) => d.diagnostico)).toEqual(['desconocido'])
    expect(result.ligadas).toBe(0)
  })
})

describe('odoo_query digiere narration', () => {
  test('el HTML del pie llega como texto también por la primitiva', async () => {
    const { odoo } = fakeOdoo({ 'account.move.search_read': [[invoice(1041, 'F00522', 1, 'S00713', '<p data-oe-version="2.0">PEDIDO: 4102931264</p>')]] })
    const result = await odooQuery(odoo, { model: 'account.move', fields: ['name', 'narration'], limit: 1 })
    expect(result.items[0].narration).toBe('PEDIDO: 4102931264')
  })
})

describe('catálogo fase 7', () => {
  test('sale_order_count se puede LEER pidiéndolo explícito, pero no filtrar (candado readOnlyFields)', async () => {
    const { odoo } = fakeOdoo({ 'account.move.search_read': [[invoice(1041, 'F00522', 1, 'S00713')]] })
    const result = await odooQuery(odoo, { model: 'account.move', fields: ['name', 'sale_order_count'], limit: 1 })
    expect(result.items[0].sale_order_count).toBe(1)

    await expect(
      odooQuery(odoo, { model: 'account.move', domain: [['sale_order_count', '=', 0]], limit: 1 }),
    ).rejects.toThrow(/computado sin almacenar/)
    await expect(
      odooQuery(odoo, { model: 'sale.order', domain: [['invoice_ids', '!=', false]], limit: 1 }),
    ).rejects.toThrow(/computado sin almacenar/)
  })

  test('los campos nuevos de líneas y el término de pago entran en la proyección por defecto', async () => {
    const { odoo, calls } = fakeOdoo({ 'sale.order.line.search_read': [[]], 'account.move.line.search_read': [[]] })
    await odooQuery(odoo, { model: 'sale.order.line', limit: 1 })
    await odooQuery(odoo, { model: 'account.move.line', limit: 1 })
    expect(calls[0].payload.fields).toEqual(expect.arrayContaining(['qty_to_invoice', 'product_uom_id', 'invoice_lines']))
    expect(calls[1].payload.fields).toEqual(expect.arrayContaining(['sale_line_ids', 'product_uom_id']))
  })
})
