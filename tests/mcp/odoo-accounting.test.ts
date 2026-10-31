/** Odoo block, phase 1: accounting (#65, ADR-025). The caller is injected and
 *  returns REAL captured shapes: many2one as [id, "name"], false for empties. */

import { describe, test, expect } from 'vitest'
import { odooSearchRecords, odooAggregateRecords, odooSummarizeInvoices } from '@/lib/mcp/tools/odoo/accounting'
import { fakeOdoo } from '../helpers/fake-odoo'

const INVOICE_RAW = {
  id: 780,
  name: 'F00387',
  partner_id: [24, 'Andritz'],
  invoice_date: '2026-08-11',
  invoice_date_due: '2026-05-10',
  amount_total: 18781.1,
  amount_residual: 18781.1,
  payment_state: 'not_paid',
  state: 'posted',
  ref: false,
}

describe('odoo_search_records', () => {
  test('modelo fuera del catálogo → error claro con los disponibles', async () => {
    const { odoo } = fakeOdoo({})
    // hr.payslip (payroll) is the canonical example of what NEVER gets in (ADR-025).
    await expect(odooSearchRecords(odoo, { modelo: 'hr.payslip' })).rejects.toThrow(/no está en el catálogo.*account\.move/)
  })

  test('campo fuera de la whitelist → error (también en el dominio)', async () => {
    const { odoo } = fakeOdoo({})
    await expect(
      odooSearchRecords(odoo, { modelo: 'account.move', campos: ['line_ids'] }),
    ).rejects.toThrow(/line_ids.*no está en el catálogo/)
    await expect(
      odooSearchRecords(odoo, { modelo: 'account.move', filtros: [['company_id', '=', 1]] }),
    ).rejects.toThrow(/No se puede filtrar/)
  })

  test('traversal por relación en el dominio → rechazado aunque el base esté permitido (PR #66)', async () => {
    // partner_id is whitelisted, but partner_id.vat would filter by a hidden
    // field (inference oracle) — verified that Odoo does filter by it.
    const { odoo } = fakeOdoo({})
    await expect(
      odooSearchRecords(odoo, { modelo: 'account.move', filtros: [['partner_id.vat', 'ilike', 'AHY']] }),
    ).rejects.toThrow(/traversal por relación/)
  })

  test('operador any con dominio anidado → rechazado: saltaría la whitelist de campos', async () => {
    const { odoo, calls } = fakeOdoo({})
    for (const filtros of [
      [['partner_id', 'any', [['vat', 'ilike', 'AHY']]]],
      [['partner_id', 'not any', [['vat', '=', false]]]],
      [['partner_id', 'child_of', 1]],
      [['payment_state', '=?', 'paid']],
      [['payment_state', 'IN', ['paid']]],
    ] as [string, string, unknown][][]) {
      await expect(odooSearchRecords(odoo, { modelo: 'account.move', filtros })).rejects.toThrow(/operador o valor/)
    }
    expect(calls).toHaveLength(0)
  })

  test('valores anidados u objetos → rechazados; listas simples con in siguen pasando', async () => {
    const { odoo } = fakeOdoo({ 'account.move.search_read': [[INVOICE_RAW]] })
    for (const filtros of [
      [['partner_id', '=', [['vat', '=', 'X']]]],
      [['partner_id', 'in', [[1, 2]]]],
      [['partner_id', 'in', 7]],
      [['payment_state', '=', { a: 1 }]],
    ] as [string, string, unknown][][]) {
      await expect(odooSearchRecords(odoo, { modelo: 'account.move', filtros })).rejects.toThrow(/operador o valor/)
    }
    await expect(
      odooSearchRecords(odoo, { modelo: 'account.move', filtros: [['payment_state', 'in', ['paid', 'not_paid']], ['amount_total', '>=', 0]] }),
    ).resolves.toMatchObject({ count: 1 })
  })

  test('una tripleta mal formada se rechaza', async () => {
    const { odoo } = fakeOdoo({})
    await expect(
      odooSearchRecords(odoo, { modelo: 'account.move', filtros: [['payment_state', '=']] as unknown as [string, string, unknown][] }),
    ).rejects.toThrow(/tripleta/)
  })

  test('order multi-columna: valida TODAS las columnas, no solo la primera (PR #66)', async () => {
    const { odoo } = fakeOdoo({ 'account.move.search_read': [[INVOICE_RAW]] })
    await expect(
      odooSearchRecords(odoo, { modelo: 'account.move', orden: 'invoice_date asc, partner_id.vat desc' }),
    ).rejects.toThrow(/traversal por relación/)
    await expect(
      odooSearchRecords(odoo, { modelo: 'account.move', orden: 'invoice_date asc, name desc' }),
    ).resolves.toMatchObject({ count: 1 })
  })

  test('normaliza: many2one → nombre, false → null; sin campos usa la whitelist', async () => {
    const { odoo, calls } = fakeOdoo({ 'account.move.search_read': [[INVOICE_RAW]] })
    const result = await odooSearchRecords(odoo, { modelo: 'account.move', limite: 5 })

    expect(calls[0].payload.fields).toContain('payment_state')
    expect(result.items[0].partner_id).toBe('Andritz')
    expect(result.items[0].ref).toBeNull()
    expect(result.count).toBe(1)
  })

  test('cuando llena el límite avisa que hay más', async () => {
    const { odoo } = fakeOdoo({ 'account.move.search_read': [[INVOICE_RAW, { ...INVOICE_RAW, id: 781 }]] })
    const result = await odooSearchRecords(odoo, { modelo: 'account.move', limite: 2 })
    expect(result.nota).toMatch(/máximo/)
  })
})

describe('odoo_aggregate_records', () => {
  test('limpia __domain y renombra el conteo; métrica inválida truena', async () => {
    const { odoo } = fakeOdoo({
      'account.move.read_group': [[
        {
          payment_state: 'not_paid',
          payment_state_count: 150,
          amount_total: 2255512.43,
          __domain: ['&', ['move_type', '=', 'out_invoice']],
        },
      ]],
    })
    const result = await odooAggregateRecords(odoo, {
      modelo: 'account.move',
      agrupar_por: 'payment_state',
      metricas: ['amount_total:sum'],
    })
    expect(result.grupos[0]).toEqual({ payment_state: 'not_paid', count: 150, amount_total: 2255512.43 })

    await expect(
      odooAggregateRecords(odoo, { modelo: 'account.move', agrupar_por: 'payment_state', metricas: ['amount_total:median'] }),
    ).rejects.toThrow(/Métrica inválida/)
  })
})

describe('odoo_summarize_invoices', () => {
  test('valida fechas y agrupa por mes con el rango en el dominio; notas de crédito del periodo aparte', async () => {
    const { odoo, calls } = fakeOdoo({
      'account.move.read_group': [
        [
          { 'invoice_date:month': 'julio 2026', invoice_date_count: 40, amount_total: 100, amount_residual: 25, __domain: [] },
          { 'invoice_date:month': 'agosto 2026', invoice_date_count: 10, amount_total: 50, amount_residual: 50, __domain: [] },
        ],
        [{ payment_state: 'not_paid', payment_state_count: 2, amount_total: 30, amount_residual: 30, __domain: [] }],
      ],
    })

    await expect(odooSummarizeInvoices(odoo, { desde: '11/08/2026' })).rejects.toThrow(/YYYY-MM-DD/)

    const result = await odooSummarizeInvoices(odoo, {
      desde: '2026-07-01',
      hasta: '2026-08-31',
      agrupar_por: 'mes',
    })

    expect(calls).toHaveLength(2)
    expect(calls[0].payload.groupby).toEqual(['invoice_date:month'])
    expect(calls[0].payload.domain).toContainEqual(['invoice_date', '>=', '2026-07-01'])
    // Same period on the credit-notes read, refunds only.
    expect(calls[1].payload.domain).toContainEqual(['move_type', '=', 'out_refund'])
    expect(calls[1].payload.domain).toContainEqual(['invoice_date', '<=', '2026-08-31'])
    // Gross figures: the credit notes do not reduce them (#102).
    expect(result.total_facturado).toBe(150)
    expect(result.total_pendiente).toBe(75)
    expect(result.grupos).toHaveLength(2)
    expect(result.notas_credito).toEqual({ total: 30, sin_aplicar: 30, documentos: 2 })
  })
})
