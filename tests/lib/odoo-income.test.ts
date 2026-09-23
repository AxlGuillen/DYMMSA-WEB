/** Income loaders (#94): exact domains, catalog fields, digested rows, truncation flag. Real captured shapes. */

import { describe, test, expect } from 'vitest'
import type { OdooCaller } from '@/lib/odoo/client'
import { ODOO_CATALOG } from '@/lib/odoo/catalog'
import { OPEN_CREDIT_NOTES_DOMAIN, OPEN_CUSTOMER_MOVES_DOMAIN, OPEN_RECEIVABLES_DOMAIN, overdueDomain } from '@/lib/odoo/domains'
import { fetchMonthCollections, fetchOpenCustomerMoves, INCOME_FETCH_LIMIT } from '@/lib/odoo/income'
import { daysSince, todayIso } from '@/lib/odoo/normalize'

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
  move_type: 'out_invoice',
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

describe('fetchOpenCustomerMoves', () => {
  test('una llamada: facturas Y notas de crédito publicadas con saldo, sin filtro de fecha', async () => {
    const { odoo, calls } = fakeOdoo({ 'account.move.search_read': [[INVOICE_RAW]] })
    const result = await fetchOpenCustomerMoves(odoo)

    expect(calls).toHaveLength(1)
    expect(calls[0].payload.domain).toEqual(OPEN_CUSTOMER_MOVES_DOMAIN)
    expect(calls[0].payload.domain).toContainEqual(['move_type', 'in', ['out_invoice', 'out_refund']])
    expect(calls[0].payload.order).toBe('invoice_date_due asc')
    expect(calls[0].payload.fields).toContain('move_type')
    for (const field of calls[0].payload.fields as string[]) {
      expect(ODOO_CATALOG['account.move'].fields).toContain(field)
    }
    expect(result.rows).toEqual([{
      id: 780,
      moveType: 'out_invoice',
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
    const result = await fetchOpenCustomerMoves(odoo)
    expect(result.rows[0].dueDate).toBeNull()
  })

  test('una nota de crédito llega como out_refund con el saldo en positivo aunque Odoo lo firme', async () => {
    const credit = { ...INVOICE_RAW, id: 887, name: 'RINV/2026/00012', move_type: 'out_refund', amount_total: -1500, amount_residual: -1500 }
    const { odoo } = fakeOdoo({ 'account.move.search_read': [[credit]] })
    const result = await fetchOpenCustomerMoves(odoo)
    expect(result.rows[0]).toMatchObject({ id: 887, moveType: 'out_refund', total: 1500, residual: 1500 })
  })
})

describe('reloj del negocio para las tools MCP', () => {
  // 02:00 UTC of the 16th is 20:00 of the 15th in Morelia.
  const night = new Date('2026-09-16T02:00:00Z')

  test('todayIso da la fecha de Morelia, no la de UTC', () => {
    expect(todayIso(night)).toBe('2026-09-15')
  })

  test('daysSince cuenta días contra la fecha de Morelia', () => {
    expect(daysSince('2026-09-14', night)).toBe(1)
    expect(daysSince('2026-09-16', night)).toBe(0)
  })
})

describe('dominios compartidos', () => {
  test('overdueDomain = abiertas + vencimiento anterior a hoy (lo que usan las tools MCP)', () => {
    expect(overdueDomain('2026-09-09')).toEqual([
      ...OPEN_RECEIVABLES_DOMAIN,
      ['invoice_date_due', '<', '2026-09-09'],
    ])
  })

  test('las vencidas siguen siendo SOLO facturas; las notas de crédito tienen su propio dominio', () => {
    expect(OPEN_RECEIVABLES_DOMAIN[0]).toEqual(['move_type', '=', 'out_invoice'])
    expect(OPEN_CREDIT_NOTES_DOMAIN[0]).toEqual(['move_type', '=', 'out_refund'])
    // Same open-balance conditions on both: a difference here would be a silent bug.
    expect(OPEN_CREDIT_NOTES_DOMAIN.slice(1)).toEqual(OPEN_RECEIVABLES_DOMAIN.slice(1))
    expect(OPEN_CUSTOMER_MOVES_DOMAIN.slice(1)).toEqual(OPEN_RECEIVABLES_DOMAIN.slice(1))
  })
})
