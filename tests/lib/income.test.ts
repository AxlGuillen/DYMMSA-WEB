/** Income math (#94, #102): month range, collections sum, due/overdue split, credit notes, closing. */

import { describe, test, expect } from 'vitest'
import { summarizeCollections, splitReceivables, summarizeCreditNotes, summarizeIncome, buildIncomeOverview, monthClosing, foreignCurrencies } from '@/lib/income'
import { monthRange } from '@/lib/month'
import type { OdooCollection, OdooOpenInvoice } from '@/lib/odoo/income'

const pay = (o: Partial<OdooCollection>): OdooCollection => ({
  id: 1, folio: 'PAY1', customer: 'Andritz', date: '2026-08-12', amount: 100, currency: 'MXN', state: 'paid', memo: null, ...o,
})
const inv = (o: Partial<OdooOpenInvoice>): OdooOpenInvoice => ({
  id: 1, moveType: 'out_invoice', folio: 'F1', customer: 'Andritz', invoiceDate: '2026-08-01', dueDate: '2026-09-01', total: 100, residual: 100, currency: 'MXN', paymentState: 'not_paid', ...o,
})
const credit = (o: Partial<OdooOpenInvoice>): OdooOpenInvoice => inv({ id: 9, moveType: 'out_refund', folio: 'RINV1', ...o })

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
      inv({ dueDate: '2026-09-08', total: 500, residual: 200, currency: 'USD' }),
      inv({ dueDate: '2026-09-09', residual: 300 }),
      inv({ dueDate: '2026-10-01', residual: 400 }),
      inv({ dueDate: null, residual: 50 }),
    ], today)
    expect(out).toEqual({
      receivableTotal: 750, receivableCount: 3, overdueTotal: 200, overdueCount: 1,
      // The USD invoice is overdue: it must not flag the "por cobrar" card.
      receivableCurrencies: [], overdueCurrencies: ['USD'],
    })
  })

  test('las notas de crédito no restan ni cuentan: el por cobrar queda bruto (decisión #102)', () => {
    const today = '2026-09-09'
    const withCredit = splitReceivables([
      inv({ dueDate: '2026-09-01', residual: 200 }),
      inv({ dueDate: '2026-10-01', residual: 300 }),
      credit({ dueDate: '2026-09-01', residual: 150, currency: 'USD' }),
    ], today)
    const without = splitReceivables([
      inv({ dueDate: '2026-09-01', residual: 200 }),
      inv({ dueDate: '2026-10-01', residual: 300 }),
    ], today)
    expect(withCredit).toEqual(without)
    expect(withCredit.overdueCurrencies).toEqual([])
  })
})

describe('summarizeCreditNotes', () => {
  test('suma el saldo de las out_refund, las cuenta y lista sus monedas; ignora facturas', () => {
    expect(summarizeCreditNotes([
      inv({ residual: 1000 }),
      credit({ residual: 150 }),
      credit({ id: 10, residual: 50.5, currency: 'USD' }),
    ])).toEqual({ creditNotesTotal: 200.5, creditNotesCount: 2, creditNoteCurrencies: ['USD'] })
  })

  test('vacío → 0', () => {
    expect(summarizeCreditNotes([inv({})])).toEqual({ creditNotesTotal: 0, creditNotesCount: 0, creditNoteCurrencies: [] })
  })
})

describe('summarizeIncome', () => {
  test('junta cobros, por cobrar, vencido, notas de crédito, truncado por lado y monedas de cada lado', () => {
    const s = summarizeIncome(
      [pay({ amount: 10 })],
      [inv({ dueDate: '2026-01-01', residual: 5, currency: 'USD' }), credit({ residual: 3 })],
      '2026-09-09',
      { collections: false, receivables: true },
    )
    expect(s).toEqual({
      collectedTotal: 10, collectedCount: 1,
      receivableTotal: 0, receivableCount: 0,
      overdueTotal: 5, overdueCount: 1,
      creditNotesTotal: 3, creditNotesCount: 1,
      collectionsTruncated: false,
      receivablesTruncated: true,
      collectionCurrencies: [],
      receivableCurrencies: [],
      overdueCurrencies: ['USD'],
      creditNoteCurrencies: [],
    })
  })
})

describe('buildIncomeOverview', () => {
  test('expone solo las notas de crédito en creditNotes y el fetchedAt más viejo', () => {
    const out = buildIncomeOverview(
      '2026-09', '2026-09-09',
      { rows: [pay({})], truncated: false, fetchedAt: '2026-09-09T10:00:00Z' },
      { rows: [inv({}), credit({ invoiceDate: '2026-08-01' }), credit({ id: 10, folio: 'RINV2', invoiceDate: '2026-09-01' })], truncated: false, fetchedAt: '2026-09-09T09:00:00Z' },
    )
    // Newest first: the read comes ordered by due date, which is not what the card shows.
    expect(out.creditNotes.map((c) => c.folio)).toEqual(['RINV2', 'RINV1'])
    // The invoice (due 09-01) is overdue; the credit note counts nowhere but creditNotes.
    expect(out.income).toMatchObject({ overdueCount: 1, receivableCount: 0, creditNotesCount: 2 })
    expect(out.fetchedAt).toBe('2026-09-09T09:00:00Z')
  })
})

describe('monthClosing', () => {
  test('real = cobrado − pagado; proyectado = real − pendientes del mes − vencidas previas; el negativo es válido', () => {
    expect(monthClosing({ collected: 10000, paid: 4000, pending: 1000, carryOver: 500 })).toEqual({
      collected: 10000, paid: 4000, pending: 1000, carryOver: 500, real: 6000, projected: 4500,
    })
    // Without carry-over the projection is just real − pending.
    expect(monthClosing({ collected: 10000, paid: 4000, pending: 1000, carryOver: 0 }).projected).toBe(5000)
    expect(monthClosing({ collected: 1000, paid: 4000, pending: 500, carryOver: 0 }).projected).toBe(-3500)
  })
})

describe('foreignCurrencies', () => {
  test('lista las monedas distintas de MXN, sin repetir', () => {
    expect(foreignCurrencies([pay({}), pay({ currency: 'USD' }), pay({ currency: 'USD' }), pay({ currency: null })])).toEqual(['USD'])
  })
})
