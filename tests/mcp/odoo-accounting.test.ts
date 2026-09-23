/** Odoo block, phase 1: accounting (#65, ADR-025). The caller is injected and
 *  returns REAL captured shapes: many2one as [id, "name"], false for empties. */

import { describe, test, expect } from 'vitest'
import type { OdooCaller } from '@/lib/odoo/client'
import {
  odooQuery,
  odooAggregate,
  odooOverdueInvoices,
  odooInvoicesSummary,
} from '@/lib/mcp/tools/odoo/accounting'

type Call = { model: string; method: string; payload: Record<string, unknown> }

/** Fake caller: records calls and dispatches responses per model.method. */
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

describe('odoo_query', () => {
  test('modelo fuera del catálogo → error claro con los disponibles', async () => {
    const { odoo } = fakeOdoo({})
    // hr.payslip (payroll) is the canonical example of what NEVER gets in (ADR-025).
    await expect(odooQuery(odoo, { model: 'hr.payslip' })).rejects.toThrow(/no está en el catálogo.*account\.move/)
  })

  test('campo fuera de la whitelist → error (también en el dominio)', async () => {
    const { odoo } = fakeOdoo({})
    await expect(
      odooQuery(odoo, { model: 'account.move', fields: ['line_ids'] }),
    ).rejects.toThrow(/line_ids.*no está en el catálogo/)
    await expect(
      odooQuery(odoo, { model: 'account.move', domain: [['company_id', '=', 1]] }),
    ).rejects.toThrow(/No se puede filtrar/)
  })

  test('traversal por relación en el dominio → rechazado aunque el base esté permitido (PR #66)', async () => {
    // partner_id is whitelisted, but partner_id.vat would filter by a hidden
    // field (inference oracle) — verified that Odoo does filter by it.
    const { odoo } = fakeOdoo({})
    await expect(
      odooQuery(odoo, { model: 'account.move', domain: [['partner_id.vat', 'ilike', 'AHY']] }),
    ).rejects.toThrow(/traversal por relación/)
  })

  test('order multi-columna: valida TODAS las columnas, no solo la primera (PR #66)', async () => {
    const { odoo } = fakeOdoo({ 'account.move.search_read': [[INVOICE_RAW]] })
    await expect(
      odooQuery(odoo, { model: 'account.move', order: 'invoice_date asc, partner_id.vat desc' }),
    ).rejects.toThrow(/traversal por relación/)
    await expect(
      odooQuery(odoo, { model: 'account.move', order: 'invoice_date asc, name desc' }),
    ).resolves.toMatchObject({ count: 1 })
  })

  test('normaliza: many2one → nombre, false → null; sin campos usa la whitelist', async () => {
    const { odoo, calls } = fakeOdoo({ 'account.move.search_read': [[INVOICE_RAW]] })
    const result = await odooQuery(odoo, { model: 'account.move', limit: 5 })

    expect(calls[0].payload.fields).toContain('payment_state')
    expect(result.items[0].partner_id).toBe('Andritz')
    expect(result.items[0].ref).toBeNull()
    expect(result.count).toBe(1)
  })

  test('cuando llena el límite avisa que hay más', async () => {
    const { odoo } = fakeOdoo({ 'account.move.search_read': [[INVOICE_RAW, { ...INVOICE_RAW, id: 781 }]] })
    const result = await odooQuery(odoo, { model: 'account.move', limit: 2 })
    expect(result.nota).toMatch(/máximo/)
  })
})

describe('odoo_aggregate', () => {
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
    const result = await odooAggregate(odoo, {
      model: 'account.move',
      group_by: 'payment_state',
      metrics: ['amount_total:sum'],
    })
    expect(result.grupos[0]).toEqual({ payment_state: 'not_paid', count: 150, amount_total: 2255512.43 })

    await expect(
      odooAggregate(odoo, { model: 'account.move', group_by: 'payment_state', metrics: ['amount_total:median'] }),
    ).rejects.toThrow(/Métrica inválida/)
  })
})

describe('odoo_overdue_invoices', () => {
  test('3 llamadas exactas; por_cliente ordenado por monto; días de atraso; notas de crédito aparte sin restar', async () => {
    const { odoo, calls } = fakeOdoo({
      'account.move.read_group': [
        [
          { partner_id: [17, 'GE POWER SERVICES MEXICO'], partner_id_count: 2, amount_residual: 49088.5, __domain: [] },
          { partner_id: [24, 'Andritz'], partner_id_count: 1, amount_residual: 18781.1, __domain: [] },
        ],
        [{ partner_id: [24, 'Andritz'], partner_id_count: 1, amount_residual: 1500, __domain: [] }],
      ],
      'account.move.search_read': [[INVOICE_RAW]],
    })

    const result = await odooOverdueInvoices(odoo, {})

    expect(calls).toHaveLength(3)
    // The overdue domain: posted + unpaid + past due as of today — invoices only.
    for (const call of calls.slice(0, 2)) {
      const domain = call.payload.domain as unknown[][]
      expect(domain).toContainEqual(['move_type', '=', 'out_invoice'])
      expect(domain).toContainEqual(['payment_state', 'in', ['not_paid', 'partial']])
      expect(domain.some(([f, op]) => f === 'invoice_date_due' && op === '<')).toBe(true)
    }
    // The third read: open credit notes, no due-date cut.
    const creditDomain = calls[2].payload.domain as unknown[][]
    expect(creditDomain).toContainEqual(['move_type', '=', 'out_refund'])
    expect(creditDomain.some(([f]) => f === 'invoice_date_due')).toBe(false)

    // Gross: the 1,500 credit is NOT subtracted (#102).
    expect(result.total_vencido).toBeCloseTo(67869.6)
    expect(result.facturas_vencidas).toBe(3)
    expect(result.por_cliente[0].cliente).toBe('GE POWER SERVICES MEXICO')
    expect(result.notas_credito_sin_aplicar).toEqual({
      total: 1500, documentos: 1, por_cliente: [{ cliente: 'Andritz', notas: 1, saldo_a_favor: 1500 }],
    })
    expect(result.mas_vencidas[0]).toMatchObject({ folio: 'F00387', cliente: 'Andritz' })
    expect(result.mas_vencidas[0].dias_vencida).toBeGreaterThan(0)
  })
})

describe('odoo_invoices_summary', () => {
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

    await expect(odooInvoicesSummary(odoo, { date_from: '11/08/2026' })).rejects.toThrow(/YYYY-MM-DD/)

    const result = await odooInvoicesSummary(odoo, {
      date_from: '2026-07-01',
      date_to: '2026-08-31',
      group_by: 'mes',
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
