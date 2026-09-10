/** Income loaders (#94): exact domains, catalog fields, digested rows, truncation flag. Real captured shapes. */

import { describe, test, expect } from 'vitest'
import type { OdooCaller } from '@/lib/odoo/client'
import { ODOO_CATALOG } from '@/lib/odoo/catalog'
import { OPEN_RECEIVABLES_DOMAIN, overdueDomain } from '@/lib/odoo/domains'
import { fetchMonthCollections, fetchOpenReceivables, INCOME_FETCH_LIMIT } from '@/lib/odoo/income'

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

const PAY00068 = {
  id: 71,
  name: 'PAY00068',
  partner_id: [24, 'Andritz'],
  date: '2026-08-12',
  amount: 59868.07,
  payment_type: 'inbound',
  state: 'paid',
  memo: false,
  partner_type: 'customer',
  currency_id: [33, 'MXN'],
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
  currency_id: [33, 'MXN'],
}

describe('fetchMonthCollections', () => {
  test('una llamada: cobros de CLIENTE registrados o conciliados, por fecha de pago dentro del mes', async () => {
    const { odoo, calls } = fakeOdoo({ 'account.payment.search_read': [[PAY00068]] })
    const result = await fetchMonthCollections(odoo, '2026-08')

    expect(calls).toHaveLength(1)
    expect(calls[0].model).toBe('account.payment')
    expect(calls[0].payload.domain).toEqual([
      ['payment_type', '=', 'inbound'],
      ['partner_type', '=', 'customer'],
      ['state', 'in', ['in_process', 'paid']],
      ['date', '>=', '2026-08-01'],
      ['date', '<', '2026-09-01'],
    ])
    expect(calls[0].payload.limit).toBe(INCOME_FETCH_LIMIT)
    expect(calls[0].payload.order).toBe('date asc')
    for (const field of calls[0].payload.fields as string[]) {
      expect(ODOO_CATALOG['account.payment'].fields).toContain(field)
    }

    expect(result.truncated).toBe(false)
    expect(result.rows).toEqual([{
      id: 71,
      folio: 'PAY00068',
      customer: 'Andritz',
      date: '2026-08-12',
      amount: 59868.07,
      currency: 'MXN',
      state: 'paid',
      memo: null,
    }])
  })

  test('diciembre cierra en el 1 de enero siguiente', async () => {
    const { odoo, calls } = fakeOdoo({ 'account.payment.search_read': [[]] })
    await fetchMonthCollections(odoo, '2026-12')
    expect(calls[0].payload.domain).toContainEqual(['date', '<', '2027-01-01'])
  })

  test('marca truncado cuando llena el límite', async () => {
    const rows = Array.from({ length: INCOME_FETCH_LIMIT }, (_, i) => ({ ...PAY00068, id: i + 1 }))
    const { odoo } = fakeOdoo({ 'account.payment.search_read': [rows] })
    const result = await fetchMonthCollections(odoo, '2026-08')
    expect(result.truncated).toBe(true)
    expect(result.rows).toHaveLength(INCOME_FETCH_LIMIT)
  })
})

describe('fetchOpenReceivables', () => {
  test('una llamada: facturas de cliente publicadas con saldo, sin filtro de fecha', async () => {
    const { odoo, calls } = fakeOdoo({ 'account.move.search_read': [[INVOICE_RAW]] })
    const result = await fetchOpenReceivables(odoo)

    expect(calls).toHaveLength(1)
    expect(calls[0].payload.domain).toEqual(OPEN_RECEIVABLES_DOMAIN)
    expect(calls[0].payload.order).toBe('invoice_date_due asc')
    for (const field of calls[0].payload.fields as string[]) {
      expect(ODOO_CATALOG['account.move'].fields).toContain(field)
    }
    expect(result.rows).toEqual([{
      id: 780,
      folio: 'F00387',
      customer: 'Andritz',
      invoiceDate: '2026-08-11',
      dueDate: '2026-05-10',
      total: 18781.1,
      residual: 18781.1,
      currency: 'MXN',
      paymentState: 'not_paid',
    }])
  })

  test('vencimiento vacío (false) llega como null', async () => {
    const { odoo } = fakeOdoo({ 'account.move.search_read': [[{ ...INVOICE_RAW, invoice_date_due: false }]] })
    const result = await fetchOpenReceivables(odoo)
    expect(result.rows[0].dueDate).toBeNull()
  })
})

describe('dominios compartidos', () => {
  test('overdueDomain = abiertas + vencimiento anterior a hoy (lo que usan las tools MCP)', () => {
    expect(overdueDomain('2026-09-09')).toEqual([
      ...OPEN_RECEIVABLES_DOMAIN,
      ['invoice_date_due', '<', '2026-09-09'],
    ])
  })
})
