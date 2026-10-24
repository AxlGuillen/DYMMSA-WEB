/** odoo_list_receivables (#155, ADR-041): the whole portfolio with ONE gross figure, like the Clientes screen. */

import { describe, test, expect } from 'vitest'
import { odooListReceivables, receivableBlock } from '@/lib/mcp/tools/odoo/receivables'
import { odooSearchRecords } from '@/lib/mcp/tools/odoo/accounting'
import { fakeOdoo } from '../helpers/fake-odoo'

// Far past / far future so the "today" of the run never flips a status.
const OPEN = (o: Record<string, unknown>) => ({
  id: 1, name: 'F1', move_type: 'out_invoice', partner_id: [24, 'Andritz'], invoice_date: '2020-01-01', invoice_date_due: '2020-02-01',
  amount_total: 100, amount_residual: 100, payment_state: 'not_paid', currency_id: [33, 'MXN'], ...o,
})
const MOVES = [
  OPEN({ id: 1, name: 'F-VIEJA', invoice_date_due: '2020-02-01', amount_residual: 100 }),
  OPEN({ id: 2, name: 'F-FUTURA', invoice_date_due: '2099-03-01', amount_residual: 40 }),
  OPEN({ id: 3, name: 'RINV1', move_type: 'out_refund', amount_residual: 30 }),
  OPEN({ id: 4, name: 'G-1', partner_id: [17, 'GE POWER SERVICES MEXICO'], amount_residual: 500 }),
  OPEN({ id: 5, name: 'G-2', partner_id: [18, 'GE Vernova'], invoice_date_due: '2099-01-01', amount_residual: 7 }),
  OPEN({ id: 6, name: 'RINV2', move_type: 'out_refund', partner_id: [30, 'Solo Nota SA'], amount_residual: 20 }),
]
// GE Vernova (18) is not returned (archived in Odoo): it keeps its row with the invoice's name and no DSO.
const PARTNERS = [
  { id: 17, name: 'GE POWER SERVICES MEXICO', days_sales_outstanding: 109.61 },
  { id: 24, name: 'Andritz', days_sales_outstanding: 88.23 },
]

describe('receivableBlock', () => {
  test('digiere las cifras netas de Odoo y redondea el DSO; false/ausente → null', () => {
    expect(receivableBlock({ total_due: 376024.81, total_overdue: 1390.26, days_sales_outstanding: 88.23 })).toEqual({
      deuda_total: 376024.81, vencido: 1390.26, dias_promedio_de_pago: 88,
    })
    expect(receivableBlock({ total_due: false })).toEqual({ deuda_total: null, vencido: null, dias_promedio_de_pago: null })
  })
})

describe('odoo_list_receivables', () => {
  test('una cifra bruta por factura en 2 llamadas: el DSO se lee solo de los clientes con saldo; notas de crédito aparte sin restar', async () => {
    const { odoo, calls } = fakeOdoo({ 'account.move.search_read': [MOVES], 'res.partner.search_read': [PARTNERS] })
    const result = await odooListReceivables(odoo)

    expect(calls.map((c) => `${c.model}.${c.method}`)).toEqual(['account.move.search_read', 'res.partner.search_read'])
    expect(calls[0].payload.domain).toContainEqual(['move_type', 'in', ['out_invoice', 'out_refund']])
    // Only who owes: the credit-only partner (30) is never read.
    expect(calls[1].payload).toMatchObject({ domain: [['id', 'in', [17, 18, 24]]], fields: ['name', 'days_sales_outstanding'] })

    expect(result).toMatchObject({
      total_por_cobrar: 647, total_vencido: 600, total_por_vencer: 47, facturas: 4, clientes_con_saldo: 3, ordenado_por: 'vencido',
    })
    expect(result.por_cliente).toEqual([
      { cliente: 'GE POWER SERVICES MEXICO', facturas: 1, vencido: 500, por_vencer: 0, total: 500, dias_promedio_de_pago: 110, monedas_sin_convertir: undefined },
      { cliente: 'Andritz', facturas: 2, vencido: 100, por_vencer: 40, total: 140, dias_promedio_de_pago: 88, monedas_sin_convertir: undefined },
      { cliente: 'GE Vernova', facturas: 1, vencido: 0, por_vencer: 7, total: 7, dias_promedio_de_pago: null, monedas_sin_convertir: undefined },
    ])
    // Gross: the 50 of credit is reported apart and does NOT reduce the 647 (#102).
    expect(result.notas_credito_sin_aplicar).toEqual({
      total: 50,
      documentos: 2,
      por_cliente: [{ cliente: 'Andritz', documentos: 1, saldo_a_favor: 30 }, { cliente: 'Solo Nota SA', documentos: 1, saldo_a_favor: 20 }],
    })
    expect(result.facturas_mas_antiguas.map((l) => [l.folio, l.cliente, l.estado])).toEqual([
      ['F-VIEJA', 'Andritz', 'vencida'],
      ['G-1', 'GE POWER SERVICES MEXICO', 'vencida'],
      ['G-2', 'GE Vernova', 'por vencer'],
      ['F-FUTURA', 'Andritz', 'por vencer'],
    ])
    // One figure: Odoo's net ledger balance never rides in the list (it lives in odoo_get_customer).
    expect(JSON.stringify(result)).not.toMatch(/deuda_total|cartera_contable/)
    expect(result.monedas_sin_convertir).toBeUndefined()
    expect(result.nota).toBeUndefined()
  })

  test('ordenar por total o por días de pago (sin DSO al final); limite recorta las listas, no los totales', async () => {
    const script = () => ({ 'account.move.search_read': [MOVES], 'res.partner.search_read': [PARTNERS] })
    const byTotal = await odooListReceivables(fakeOdoo(script()).odoo, { ordenar: 'total', limite: 2 })
    expect(byTotal.por_cliente.map((c) => c.cliente)).toEqual(['GE POWER SERVICES MEXICO', 'Andritz'])
    expect(byTotal.facturas_mas_antiguas.map((l) => l.folio)).toEqual(['F-VIEJA', 'G-1'])
    expect(byTotal).toMatchObject({ total_por_cobrar: 647, clientes_con_saldo: 3, ordenado_por: 'total' })

    const slow = await odooListReceivables(fakeOdoo(script()).odoo, { ordenar: 'dias_pago' })
    expect(slow.por_cliente.map((c) => [c.cliente, c.dias_promedio_de_pago])).toEqual([
      ['GE POWER SERVICES MEXICO', 110],
      ['Andritz', 88],
      ['GE Vernova', null],
    ])
  })

  test('una factura en dólares se suma sin convertir y se avisa en el total y en su cliente', async () => {
    const usd = [...MOVES, OPEN({ id: 7, name: 'F-USD', currency_id: [2, 'USD'], amount_residual: 10 })]
    const { odoo } = fakeOdoo({ 'account.move.search_read': [usd], 'res.partner.search_read': [PARTNERS] })
    const result = await odooListReceivables(odoo)
    expect(result).toMatchObject({ total_por_cobrar: 657, monedas_sin_convertir: ['USD'] })
    expect(result.por_cliente.find((c) => c.cliente === 'Andritz')).toMatchObject({ total: 150, monedas_sin_convertir: ['USD'] })
    expect(result.por_cliente.find((c) => c.cliente === 'GE Vernova')?.monedas_sin_convertir).toBeUndefined()
  })

  test('sin facturas abiertas: una sola llamada, sin leer clientes; la lectura llena avisa', async () => {
    const empty = fakeOdoo({ 'account.move.search_read': [[]] })
    const none = await odooListReceivables(empty.odoo)
    expect(empty.calls).toHaveLength(1)
    expect(none).toMatchObject({ total_por_cobrar: 0, clientes_con_saldo: 0, por_cliente: [], facturas_mas_antiguas: [] })

    expect(none.truncado).toBe(false)

    const full = Array.from({ length: 500 }, (_, i) => OPEN({ id: i + 1, name: `F${i}`, partner_id: [24, 'Andritz'] }))
    const { odoo } = fakeOdoo({ 'account.move.search_read': [full], 'res.partner.search_read': [PARTNERS] })
    const capped = await odooListReceivables(odoo)
    expect(capped.truncado).toBe(true)
    expect(capped.nota).toMatch(/máximo de facturas abiertas/)
  })

  test('sin vencimiento ordena por la fecha de factura, como la pantalla Clientes', async () => {
    const moves = [
      OPEN({ id: 1, name: 'F-SIN-FECHAS', invoice_date: false, invoice_date_due: false }),
      OPEN({ id: 2, name: 'F-SOLO-EMISION', invoice_date: '2020-01-15', invoice_date_due: false }),
      OPEN({ id: 3, name: 'F-VENCE', invoice_date_due: '2020-03-01' }),
    ]
    const { odoo } = fakeOdoo({ 'account.move.search_read': [moves], 'res.partner.search_read': [PARTNERS] })
    const { facturas_mas_antiguas } = await odooListReceivables(odoo)
    expect(facturas_mas_antiguas.map((f) => f.folio)).toEqual(['F-SOLO-EMISION', 'F-VENCE', 'F-SIN-FECHAS'])
  })
})

describe('catálogo fase 8', () => {
  test('total_due/DSO se leen pidiéndolos explícito; filtrar u ordenar por ellos se rechaza', async () => {
    const { odoo } = fakeOdoo({ 'res.partner.search_read': [[{ id: 17, name: 'GE', total_due: 1451917.94, days_sales_outstanding: 109.61 }]] })
    const result = await odooSearchRecords(odoo, { model: 'res.partner', fields: ['name', 'total_due', 'days_sales_outstanding'], limit: 1 })
    await expect(odooSearchRecords(odoo, { model: 'res.partner', fields: ['credit'] })).rejects.toThrow(/no está en el catálogo/)
    expect(result.items[0].total_due).toBe(1451917.94)

    await expect(odooSearchRecords(odoo, { model: 'res.partner', domain: [['total_overdue', '>', 0]] })).rejects.toThrow(/computado sin almacenar/)
    await expect(odooSearchRecords(odoo, { model: 'res.partner', order: 'days_sales_outstanding desc' })).rejects.toThrow(/computado sin almacenar/)
  })
})
