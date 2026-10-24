/** Payables math (#84). The clock is always injected; nothing reads new Date(). */

import { describe, test, expect } from 'vitest'
import { currencyLabel, currencySuffix, payableTotals, weeksByCurrency, splitByCurrency, daysUntilDue, describeAuditEvent, dueDateFrom, monthOf, nextMonth, PAID_AT_NEEDS_PAID, PAID_AT_REQUIRED, parseAmountFilter, parsePayableUpdate, paymentTermsLabel, resolvePayableFilter, resolvePaymentUpdate, summarizeMonth, weekOfMonth } from '@/lib/payables'
import type { Payable } from '@/types/database'

function payable(overrides: Partial<Payable> = {}): Payable {
  return {
    id: `p-${Math.random().toString(36).slice(2, 7)}`,
    supplier_id: 's1',
    concept: 'Factura',
    amount: 100,
    currency: 'MXN',
    invoice_date: '2026-09-01',
    due_date: '2026-09-15',
    status: 'pending',
    paid_at: null,
    notes: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('dueDateFrom', () => {
  test('suma los días del plazo', () => {
    expect(dueDateFrom('2026-09-01', 30)).toBe('2026-10-01')
    expect(dueDateFrom('2026-09-01', 15)).toBe('2026-09-16')
  })

  test('cruza fin de mes y fin de año', () => {
    expect(dueDateFrom('2026-08-25', 15)).toBe('2026-09-09')
    expect(dueDateFrom('2026-12-20', 30)).toBe('2027-01-19')
  })

  test('sin plazo (contado/null/0) devuelve la misma fecha', () => {
    expect(dueDateFrom('2026-09-01', null)).toBe('2026-09-01')
    expect(dueDateFrom('2026-09-01', undefined)).toBe('2026-09-01')
    expect(dueDateFrom('2026-09-01', 0)).toBe('2026-09-01')
  })

  test('fecha inválida se devuelve tal cual (no revienta)', () => {
    expect(dueDateFrom('garbage', 30)).toBe('garbage')
  })
})

describe('daysUntilDue', () => {
  test('positivo por vencer, negativo vencida, 0 hoy', () => {
    expect(daysUntilDue('2026-09-20', '2026-09-15')).toBe(5)
    expect(daysUntilDue('2026-09-10', '2026-09-15')).toBe(-5)
    expect(daysUntilDue('2026-09-15', '2026-09-15')).toBe(0)
  })
})

describe('summarizeMonth', () => {
  const today = '2026-09-10'
  const month = '2026-09'

  test('pendientes del mes por semana + vencidas + por vencer', () => {
    const rows = [
      payable({ due_date: '2026-09-03', amount: 100 }),  // week 1, overdue (today = 10)
      payable({ due_date: '2026-09-12', amount: 200 }),  // week 2, due soon <= 7d
      payable({ due_date: '2026-09-25', amount: 300 }),  // week 4
      payable({ due_date: '2026-08-20', amount: 50 }),   // overdue from AUGUST: counts as overdue, not in the month
    ]
    const s = summarizeMonth(rows, month, today)

    expect(s.pendingTotal).toBe(600)     // only the ones DUE in September
    expect(s.pendingCount).toBe(3)
    expect(s.overdueTotal).toBe(150)     // 100 (sep 3) + 50 (dragged from August)
    expect(s.carryOverTotal).toBe(50)    // only the August one: sep 3 already sits in pendingTotal
    expect(s.carryOverCount).toBe(1)
    expect(s.overdueCount).toBe(2)
    expect(s.dueSoonTotal).toBe(200)     // due on the 12th, today is the 10th
    expect(s.weeks.map((w) => [w.week, w.total])).toEqual([[1, 100], [2, 200], [4, 300]])
  })

  test('pagadas cuentan por MES DE PAGO real, no de vencimiento', () => {
    const rows = [
      payable({ status: 'paid', due_date: '2026-08-31', paid_at: '2026-09-02', amount: 400 }),
      payable({ status: 'paid', due_date: '2026-09-05', paid_at: '2026-10-01', amount: 999 }), // paid in October
    ]
    const s = summarizeMonth(rows, month, today)
    expect(s.paidTotal).toBe(400)
    expect(s.paidCount).toBe(1)
    expect(s.pendingTotal).toBe(0)
  })

  test('las canceladas no cuentan en nada', () => {
    const s = summarizeMonth([payable({ status: 'cancelled', due_date: '2026-09-05' })], month, today)
    expect(s.pendingTotal).toBe(0)
    expect(s.overdueTotal).toBe(0)
    expect(s.paidTotal).toBe(0)
  })

  test('día 29-31 cae en la semana 5 (tope del bucket)', () => {
    const s = summarizeMonth([payable({ due_date: '2026-09-30', amount: 10 })], month, today)
    expect(s.weeks).toEqual([{ week: 5, label: 'Semana 5', total: 10, count: 1 }])
  })
})

describe('monthOf', () => {
  test('recorta YYYY-MM', () => {
    expect(monthOf('2026-09-15')).toBe('2026-09')
  })
})

describe('nextMonth', () => {
  test('devuelve el primer dia del mes siguiente, no el dia 31', () => {
    // The bug behind the helper: `${month}-31` is invalid in short months and
    // Postgres answers 22008, taking the September overview down.
    expect(nextMonth('2026-09')).toBe('2026-10-01')
    expect(nextMonth('2026-02')).toBe('2026-03-01')
  })

  test('cruza el ano en diciembre', () => {
    expect(nextMonth('2026-12')).toBe('2027-01-01')
  })
})

describe('weekOfMonth', () => {
  // Shared contract: the server uses it in summarizeMonth and the client to bucket
  // each row by week. If they drift apart, the totals stop matching.
  test('agrupa por dia del mes en tramos de 7', () => {
    expect(weekOfMonth('2026-09-01')).toBe(1)
    expect(weekOfMonth('2026-09-07')).toBe(1)
    expect(weekOfMonth('2026-09-08')).toBe(2)
  })

  test('el cierre de mes se topa en la semana 5', () => {
    expect(weekOfMonth('2026-08-29')).toBe(5)
    expect(weekOfMonth('2026-08-31')).toBe(5)
  })
})

describe('paymentTermsLabel', () => {
  test('null es contado, los presets usan su etiqueta, el resto queda en dias', () => {
    expect(paymentTermsLabel(null)).toBe('Contado')
    expect(paymentTermsLabel(7)).toBe('1 semana')
    expect(paymentTermsLabel(30)).toBe('1 mes')
    expect(paymentTermsLabel(45)).toBe('45 días')
    // The API and the MCP can store 0; reading it back as "0 días" would be wrong.
    expect(paymentTermsLabel(0)).toBe('Contado')
  })
})

describe('describeAuditEvent', () => {
  const day = (iso: string) => `[${iso}]`
  test('cada acción de la bitácora tiene su frase en español', () => {
    expect(describeAuditEvent({ action: 'created', data: {} }, day)).toBe('Registrada')
    expect(describeAuditEvent({ action: 'deleted', data: {} }, day)).toBe('Eliminada')
    expect(describeAuditEvent({ action: 'status_changed', data: { to: { status: 'paid', paid_at: '2026-09-10' } } }, day))
      .toBe('Marcada como pagada el [2026-09-10]')
    expect(describeAuditEvent({ action: 'status_changed', data: { to: { status: 'pending', paid_at: null } } }, day))
      .toBe('Regresada a pendiente')
    expect(describeAuditEvent({ action: 'status_changed', data: { to: { status: 'cancelled' } } }, day)).toBe('Cancelada')
    expect(describeAuditEvent({ action: 'paid_at_changed', data: { from: { paid_at: '2026-09-10' }, to: { paid_at: '2026-09-12' } } }, day))
      .toBe('Fecha de pago corregida: [2026-09-10] → [2026-09-12]')
  })

  test('#157: amount_changed dice monto, moneda o ambos; la moneda cambiada nombra los dos lados', () => {
    const amount = (from: object, to: object) => describeAuditEvent({ action: 'amount_changed', data: { from, to } }, day)
    expect(amount({ amount: 1500, currency: 'MXN' }, { amount: 1800, currency: 'MXN' })).toBe('Monto corregido: $1,500.00 → $1,800.00')
    expect(amount({ amount: 300, currency: 'USD' }, { amount: 350, currency: 'USD' })).toBe('Monto corregido: $300.00 USD → $350.00 USD')
    expect(amount({ amount: 300, currency: 'MXN' }, { amount: 300, currency: 'USD' })).toBe('Moneda corregida: $300.00 MXN → $300.00 USD')
    expect(amount({ amount: 6000, currency: 'MXN' }, { amount: 300, currency: 'USD' })).toBe('Monto y moneda corregidos: $6,000.00 MXN → $300.00 USD')
  })
})

describe('parseAmountFilter', () => {
  test('acepta montos con separador de miles o signo; rechaza lo que no es un monto', () => {
    expect(parseAmountFilter('1,500')).toBe('1500')
    expect(parseAmountFilter('$ 2,500.50')).toBe('2500.5')
    expect(parseAmountFilter('0')).toBe('0')
    // parseFloat('1,500') would have given 1 — the whole reason this exists (review PR #106).
    expect(parseAmountFilter('abc')).toBe('')
    expect(parseAmountFilter('-5')).toBe('')
    expect(parseAmountFilter('')).toBe('')
  })
})

describe('resolvePaymentUpdate (regla compartida ruta/MCP, #109)', () => {
  test('paid sin fecha sella hoy; con fecha la respeta', () => {
    expect(resolvePaymentUpdate('paid', undefined, '2026-09-24')).toEqual({ ok: true, updates: { status: 'paid', paid_at: '2026-09-24' } })
    expect(resolvePaymentUpdate('paid', null, '2026-09-24')).toEqual({ ok: true, updates: { status: 'paid', paid_at: '2026-09-24' } })
    expect(resolvePaymentUpdate('paid', '2026-09-10', '2026-09-24')).toEqual({ ok: true, updates: { status: 'paid', paid_at: '2026-09-10' } })
  })

  test('cualquier otro estado limpia la fecha; estado o fecha inválidos → error', () => {
    expect(resolvePaymentUpdate('pending', null, '2026-09-24')).toEqual({ ok: true, updates: { status: 'pending', paid_at: null } })
    expect(resolvePaymentUpdate('cancelled', undefined, '2026-09-24')).toEqual({ ok: true, updates: { status: 'cancelled', paid_at: null } })
    expect(resolvePaymentUpdate('pagada', undefined, '2026-09-24')).toEqual({ ok: false, error: 'Estado inválido' })
    expect(resolvePaymentUpdate('paid', '10/09/2026', '2026-09-24')).toEqual({ ok: false, error: 'Fecha de pago inválida' })
    // Shape is not enough: Postgres answers 22008 for a day that does not exist (review PR #128).
    expect(resolvePaymentUpdate('paid', '2026-02-30', '2026-09-24')).toEqual({ ok: false, error: 'Fecha de pago inválida' })
  })

  test('#157: solo una factura que queda pagada lleva fecha de pago', () => {
    // A non-paid status with a date is a contradiction, not something to drop in silence.
    expect(resolvePaymentUpdate('pending', '2026-09-10', '2026-09-24')).toEqual({ ok: false, error: PAID_AT_NEEDS_PAID })
    expect(resolvePaymentUpdate('cancelled', '2026-09-10', '2026-09-24')).toEqual({ ok: false, error: PAID_AT_NEEDS_PAID })
    // Without status, the current one decides.
    expect(resolvePaymentUpdate(undefined, '2026-09-10', '2026-09-24', 'pending')).toEqual({ ok: false, error: PAID_AT_NEEDS_PAID })
    expect(resolvePaymentUpdate(undefined, '2026-09-10', '2026-09-24', 'cancelled')).toEqual({ ok: false, error: PAID_AT_NEEDS_PAID })
    expect(resolvePaymentUpdate(undefined, '2026-09-10', '2026-09-24')).toEqual({ ok: false, error: PAID_AT_NEEDS_PAID })
    expect(resolvePaymentUpdate(undefined, '2026-09-10', '2026-09-24', 'paid')).toEqual({ ok: true, updates: { paid_at: '2026-09-10' } })
    // A paid one never loses its date: going back to pending is the way.
    expect(resolvePaymentUpdate(undefined, null, '2026-09-24', 'paid')).toEqual({ ok: false, error: PAID_AT_REQUIRED })
    expect(resolvePaymentUpdate(undefined, '2026-02-30', '2026-09-24', 'paid')).toEqual({ ok: false, error: 'Fecha de pago inválida' })
  })
})

describe('parsePayableUpdate (regla compartida PATCH / update_payable, #134)', () => {
  const TODAY = '2026-09-24'

  test('sparse: solo lo que viene, recortado; notas vacías → null; estado por resolvePaymentUpdate', () => {
    expect(parsePayableUpdate({ concept: ' Perfiles ', notes: '  ' }, TODAY)).toEqual({ ok: true, updates: { concept: 'Perfiles', notes: null } })
    expect(parsePayableUpdate({ status: 'cancelled' }, TODAY)).toEqual({ ok: true, updates: { status: 'cancelled', paid_at: null } })
    expect(parsePayableUpdate({ status: 'paid' }, TODAY)).toEqual({ ok: true, updates: { status: 'paid', paid_at: TODAY } })
    expect(parsePayableUpdate({ paid_at: '2026-09-10' }, TODAY, 'paid')).toEqual({ ok: true, updates: { paid_at: '2026-09-10' } })
    expect(parsePayableUpdate({}, TODAY)).toEqual({ ok: true, updates: {} })
  })

  test('#157: una fecha de pago suelta sobre una pendiente o cancelada → error (la regla es de resolvePaymentUpdate)', () => {
    expect(parsePayableUpdate({ paid_at: '2026-09-10' }, TODAY, 'pending')).toEqual({ ok: false, error: PAID_AT_NEEDS_PAID })
    expect(parsePayableUpdate({ paid_at: '2026-09-10', notes: 'x' }, TODAY, 'cancelled')).toEqual({ ok: false, error: PAID_AT_NEEDS_PAID })
    // Unknown current status (no row read) never lets a bare date through.
    expect(parsePayableUpdate({ paid_at: '2026-09-10' }, TODAY)).toEqual({ ok: false, error: PAID_AT_NEEDS_PAID })
    // What the edit popup sends when it leaves paid: status + null, accepted.
    expect(parsePayableUpdate({ status: 'pending', paid_at: null }, TODAY, 'paid')).toEqual({ ok: true, updates: { status: 'pending', paid_at: null } })
  })

  test('REGLA: fechas que existen, no solo con forma de fecha', () => {
    expect(parsePayableUpdate({ invoice_date: '2026-02-28', due_date: '2026-03-30' }, TODAY))
      .toEqual({ ok: true, updates: { invoice_date: '2026-02-28', due_date: '2026-03-30' } })
    expect(parsePayableUpdate({ due_date: '2026-02-30' }, TODAY)).toEqual({ ok: false, error: 'Fecha inválida en due_date' })
    expect(parsePayableUpdate({ invoice_date: '2026-13-01' }, TODAY)).toEqual({ ok: false, error: 'Fecha inválida en invoice_date' })
    expect(parsePayableUpdate({ paid_at: '2026-04-31' }, TODAY, 'paid')).toEqual({ ok: false, error: 'Fecha de pago inválida' })
  })

  test('concepto vacío, monto no positivo, proveedor vacío y estado desconocido → error', () => {
    expect(parsePayableUpdate({ concept: '  ' }, TODAY)).toEqual({ ok: false, error: 'El concepto no puede quedar vacío' })
    expect(parsePayableUpdate({ amount: 0 }, TODAY)).toEqual({ ok: false, error: 'El monto debe ser mayor a 0' })
    expect(parsePayableUpdate({ amount: '10' }, TODAY)).toEqual({ ok: false, error: 'El monto debe ser mayor a 0' })
    expect(parsePayableUpdate({ supplier_id: '' }, TODAY)).toEqual({ ok: false, error: 'Proveedor inválido' })
    expect(parsePayableUpdate({ status: 'pagada' }, TODAY)).toEqual({ ok: false, error: 'Estado inválido' })
  })
})

describe('resolvePayableFilter', () => {
  test('overdue = pendientes que vencen antes de hoy; los estados pasan tal cual; otro valor no filtra', () => {
    expect(resolvePayableFilter('overdue', '2026-10-01')).toEqual({ status: 'pending', dueBefore: '2026-10-01' })
    expect(resolvePayableFilter('paid', '2026-10-01')).toEqual({ status: 'paid' })
    expect(resolvePayableFilter('vencida', '2026-10-01')).toBeNull()
  })
})

describe('moneda (2026-10-20)', () => {
  test('payableTotals suma cada moneda aparte, redondea a centavos y nunca convierte', () => {
    expect(payableTotals([{ amount: 0.1, currency: 'MXN' }, { amount: 0.2, currency: 'MXN' }, { amount: 50, currency: 'USD' }]))
      .toEqual({ count: 3, byCurrency: { MXN: 0.3, USD: 50 } })
    expect(payableTotals([])).toEqual({ count: 0, byCurrency: {} })
  })

  test('splitByCurrency deja los pesos para el cierre y aparta los dólares', () => {
    const rows = [payable({ id: 'a', currency: 'MXN' }), payable({ id: 'b', currency: 'USD' })]
    const { mxn, foreign } = splitByCurrency(rows)
    expect(mxn.map((r) => r.id)).toEqual(['a'])
    expect(foreign.USD?.map((r) => r.id)).toEqual(['b'])
  })

  test('parsePayableUpdate acepta MXN/USD y rechaza otra moneda', () => {
    expect(parsePayableUpdate({ currency: 'USD' }, '2026-10-20')).toEqual({ ok: true, updates: { currency: 'USD' } })
    expect(parsePayableUpdate({ currency: 'EUR' }, '2026-10-20')).toEqual({ ok: false, error: 'Moneda inválida: usa MXN o USD' })
  })

  test('currencySuffix solo marca lo que no es peso; currencyLabel nombra las dos', () => {
    expect(currencySuffix('MXN')).toBe('')
    expect(currencySuffix('USD')).toBe(' USD')
    expect(currencyLabel('MXN')).toBe(' MXN')
  })

  test('weeksByCurrency agrupa por semana con total por moneda; una semana solo en dólares también sale', () => {
    const weeks = weeksByCurrency([
      payable({ id: 'a', due_date: '2026-10-03', amount: 100, currency: 'MXN' }),
      payable({ id: 'b', due_date: '2026-10-20', amount: 30, currency: 'USD' }),
      payable({ id: 'c', due_date: '2026-10-05', amount: 50, currency: 'USD' }),
    ])
    expect(weeks.map((w) => [w.label, w.rows.map((r) => r.id), w.totals])).toEqual([
      ['Semana 1', ['a', 'c'], { count: 2, byCurrency: { MXN: 100, USD: 50 } }],
      ['Semana 3', ['b'], { count: 1, byCurrency: { USD: 30 } }],
    ])
  })
})
