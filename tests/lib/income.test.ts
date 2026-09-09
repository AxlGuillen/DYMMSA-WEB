/** Income math (#94): month range, collections sum, due/overdue split, closing. */

import { describe, test, expect } from 'vitest'
import {
  monthRange, summarizeCollections, splitReceivables, summarizeIncome, monthClosing, foreignCurrencies,
} from '@/lib/income'
import type { OdooCollection, OdooOpenInvoice } from '@/lib/odoo/income'

const pay = (o: Partial<OdooCollection>): OdooCollection => ({
  id: 1, folio: 'PAY1', customer: 'Andritz', date: '2026-08-12', amount: 100, currency: 'MXN', state: 'paid', memo: null, ...o,
})
const inv = (o: Partial<OdooOpenInvoice>): OdooOpenInvoice => ({
  id: 1, folio: 'F1', customer: 'Andritz', invoiceDate: '2026-08-01', dueDate: '2026-09-01', total: 100, residual: 100, paymentState: 'not_paid', ...o,
})

describe('monthRange', () => {
  test('fin exclusivo: febrero cierra el 1 de marzo, diciembre el 1 de enero', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', toExclusive: '2026-03-01' })
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', toExclusive: '2027-01-01' })
  })
})

describe('summarizeCollections', () => {
  test('suma montos y cuenta cobros; vacío → 0', () => {
    const out = summarizeCollections([pay({ amount: 59868.07 }), pay({ amount: 1156 })])
    expect(out.collectedTotal).toBeCloseTo(61024.07, 2)
    expect(out.collectedCount).toBe(2)
    expect(summarizeCollections([])).toEqual({ collectedTotal: 0, collectedCount: 0 })
  })
})

describe('splitReceivables', () => {
  test('vence antes de hoy → vencido; hoy, después o sin fecha → por cobrar; usa el saldo, no el total', () => {
    const today = '2026-09-09'
    const out = splitReceivables([
      inv({ dueDate: '2026-09-08', total: 500, residual: 200 }),
      inv({ dueDate: '2026-09-09', residual: 300 }),
      inv({ dueDate: '2026-10-01', residual: 400 }),
      inv({ dueDate: null, residual: 50 }),
    ], today)
    expect(out).toEqual({ receivableTotal: 750, receivableCount: 3, overdueTotal: 200, overdueCount: 1 })
  })
})

describe('summarizeIncome', () => {
  test('junta cobros, por cobrar, vencido y el flag de truncado', () => {
    const s = summarizeIncome([pay({ amount: 10 })], [inv({ dueDate: '2026-01-01', residual: 5 })], '2026-09-09', true)
    expect(s).toEqual({
      collectedTotal: 10, collectedCount: 1,
      receivableTotal: 0, receivableCount: 0,
      overdueTotal: 5, overdueCount: 1,
      truncated: true,
    })
  })
})

describe('monthClosing', () => {
  test('real = cobrado − pagado; proyectado = real − pendientes; el negativo es válido', () => {
    expect(monthClosing({ collected: 10000, paid: 4000, pending: 1000 })).toEqual({
      collected: 10000, paid: 4000, pending: 1000, real: 6000, projected: 5000,
    })
    expect(monthClosing({ collected: 1000, paid: 4000, pending: 500 }).projected).toBe(-3500)
  })
})

describe('foreignCurrencies', () => {
  test('lista las monedas distintas de MXN, sin repetir', () => {
    expect(foreignCurrencies([pay({}), pay({ currency: 'USD' }), pay({ currency: 'USD' }), pay({ currency: null })])).toEqual(['USD'])
  })
})
