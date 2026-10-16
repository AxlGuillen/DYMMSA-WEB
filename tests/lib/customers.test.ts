/** Clientes (#145, ADR-039): the due-date window, the statement and the per-customer summary. Clock injected. */

import { describe, test, expect } from 'vitest'
import type { OdooOpenInvoice } from '@/lib/odoo/income'
import type { OdooCustomer } from '@/lib/odoo/customers'
import {
  customerCreditNotes,
  customersTotals,
  customerStatement,
  daysLabel,
  defaultStatementRange,
  parseStatementRange,
  rangeLabel,
  rangeQuery,
  statementLines,
  statementTotals,
  summarizeCustomers,
  type StatementRange,
} from '@/lib/customers'

const TODAY = '2026-10-15'
const ALL: StatementRange = { from: null, to: null, filter: 'all' }

const inv = (o: Partial<OdooOpenInvoice>): OdooOpenInvoice => ({
  id: 1, moveType: 'out_invoice', folio: 'F1', customer: 'Andritz', customerId: 24, invoiceDate: '2026-09-01',
  dueDate: '2026-10-01', total: 100, residual: 100, currency: 'MXN', paymentState: 'not_paid', ...o,
})
const credit = (o: Partial<OdooOpenInvoice>): OdooOpenInvoice => inv({ id: 90, moveType: 'out_refund', folio: 'RINV1', ...o })
const customer = (o: Partial<OdooCustomer>): OdooCustomer => ({
  id: 24, name: 'Andritz', city: 'Morelia', phone: null, email: null, vat: null, daysToPay: null, ...o,
})
const params = (o: Record<string, string>) => new URLSearchParams(o)

describe('defaultStatementRange', () => {
  test('todo lo vencido (sin "desde") hasta el fin del mes en curso', () => {
    expect(defaultStatementRange(TODAY)).toEqual({ from: null, to: '2026-10-31', filter: 'all' })
  })

  test('febrero bisiesto y diciembre cierran en su último día real', () => {
    expect(defaultStatementRange('2028-02-10').to).toBe('2028-02-29')
    expect(defaultStatementRange('2026-12-05').to).toBe('2026-12-31')
  })
})

describe('parseStatementRange', () => {
  test('sin parámetros toma el default', () => {
    expect(parseStatementRange(params({}), TODAY)).toEqual({ ok: true, range: defaultStatementRange(TODAY) })
  })

  test('un parámetro vacío abre ese límite (los inputs mandan los dos)', () => {
    expect(parseStatementRange(params({ from: '', to: '', filter: 'overdue' }), TODAY))
      .toEqual({ ok: true, range: { from: null, to: null, filter: 'overdue' } })
  })

  test('fecha inexistente, rango invertido y filtro desconocido → error con mensaje', () => {
    expect(parseStatementRange(params({ to: '2026-02-30' }), TODAY)).toEqual({ ok: false, error: 'Fecha inválida — usa YYYY-MM-DD' })
    expect(parseStatementRange(params({ from: '2026-11-01', to: '2026-10-01' }), TODAY))
      .toEqual({ ok: false, error: 'La fecha "desde" no puede ser posterior a "hasta"' })
    expect(parseStatementRange(params({ filter: 'todas' }), TODAY)).toEqual({ ok: false, error: 'Filtro inválido' })
  })

  test('rangeQuery ida y vuelta conserva el rango, incluidos los límites abiertos', () => {
    const range: StatementRange = { from: null, to: '2026-12-31', filter: 'upcoming' }
    expect(parseStatementRange(new URLSearchParams(rangeQuery(range)), TODAY)).toEqual({ ok: true, range })
  })
})

describe('statementLines', () => {
  const moves = [
    inv({ id: 1, folio: 'F1', dueDate: '2026-08-01' }),
    inv({ id: 2, folio: 'F2', dueDate: TODAY }),
    inv({ id: 3, folio: 'F3', dueDate: '2026-12-10' }),
    inv({ id: 4, folio: 'F4', customerId: 99, customer: 'GE POWER' }),
    credit({ dueDate: '2026-09-01' }),
  ]

  test('solo facturas del cliente (nunca notas de crédito), de la más vieja a la más nueva', () => {
    expect(statementLines(moves, 24, ALL, TODAY).map((l) => l.folio)).toEqual(['F1', 'F2', 'F3'])
  })

  test('vencer HOY es "por vencer" (mismo < que el resto de la app)', () => {
    const lines = statementLines(moves, 24, ALL, TODAY)
    expect(lines.map((l) => [l.folio, l.status, l.days])).toEqual([
      ['F1', 'overdue', 75],
      ['F2', 'upcoming', 0],
      ['F3', 'upcoming', 56],
    ])
  })

  test('el rango corta por fecha de VENCIMIENTO, ambos extremos inclusivos', () => {
    const range: StatementRange = { from: '2026-08-01', to: TODAY, filter: 'all' }
    expect(statementLines(moves, 24, range, TODAY).map((l) => l.folio)).toEqual(['F1', 'F2'])
  })

  test('el filtro deja solo vencidas o solo por vencer', () => {
    expect(statementLines(moves, 24, { ...ALL, filter: 'overdue' }, TODAY).map((l) => l.folio)).toEqual(['F1'])
    expect(statementLines(moves, 24, { ...ALL, filter: 'upcoming' }, TODAY).map((l) => l.folio)).toEqual(['F2', 'F3'])
  })

  test('sin vencimiento usa la fecha de factura; sin ninguna fecha nunca se esconde', () => {
    const odd = [
      inv({ id: 5, folio: 'SINVENC', dueDate: null, invoiceDate: '2026-01-05' }),
      inv({ id: 6, folio: 'SINFECHA', dueDate: null, invoiceDate: null }),
    ]
    const range: StatementRange = { from: '2026-10-01', to: '2026-10-31', filter: 'all' }
    expect(statementLines(odd, 24, range, TODAY).map((l) => l.folio)).toEqual(['SINFECHA'])
    expect(statementLines(odd, 24, range, TODAY)[0]).toMatchObject({ status: 'upcoming', days: null })
  })
})

test('las líneas sin fecha van al final, no delante de las más vencidas', () => {
  const lines = statementLines([inv({ id: 9, folio: 'SINFECHA', dueDate: null, invoiceDate: null }), inv({ id: 1, folio: 'F1' })], 24, ALL, TODAY)
  expect(lines.map((l) => l.folio)).toEqual(['F1', 'SINFECHA'])
})

describe('textos del estado de cuenta', () => {
  test('daysLabel habla igual en pantalla, impresión y Excel', () => {
    expect(daysLabel({ status: 'overdue', days: 1 })).toBe('vencida hace 1 día')
    expect(daysLabel({ status: 'overdue', days: 12 })).toBe('vencida hace 12 días')
    expect(daysLabel({ status: 'upcoming', days: 0 })).toBe('vence hoy')
    expect(daysLabel({ status: 'upcoming', days: 5 })).toBe('vence en 5 días')
    expect(daysLabel({ status: 'upcoming', days: null })).toBe('sin vencimiento')
  })

  test('rangeLabel pone el rango en palabras con el formato que le pasen', () => {
    const fmt = (iso: string) => iso.split('-').reverse().join('/')
    expect(rangeLabel({ from: '2026-10-01', to: '2026-10-31', filter: 'all' }, fmt)).toBe('Vence del 01/10/2026 al 31/10/2026')
    expect(rangeLabel({ from: null, to: '2026-10-31', filter: 'all' }, fmt)).toBe('Vence hasta el 31/10/2026')
    expect(rangeLabel({ from: '2026-10-01', to: null, filter: 'all' }, fmt)).toBe('Vence desde el 01/10/2026')
    expect(rangeLabel(ALL, fmt)).toBe('Todas las fechas de vencimiento')
  })
})

describe('totales', () => {
  test('statementTotals suma SALDOS (no totales) y redondea a centavos', () => {
    const lines = statementLines(
      [
        inv({ id: 1, dueDate: '2026-09-01', total: 500, residual: 0.1 }),
        inv({ id: 2, dueDate: '2026-09-02', residual: 0.2 }),
        inv({ id: 3, dueDate: '2026-11-01', residual: 50 }),
      ],
      24, ALL, TODAY,
    )
    expect(statementTotals(lines)).toEqual({ overdue: 0.3, overdueCount: 2, upcoming: 50, upcomingCount: 1, total: 50.3, count: 3 })
  })

  test('las notas de crédito se juntan sin rango de fechas, la más nueva primero (#102)', () => {
    const moves = [
      credit({ id: 90, folio: 'R1', invoiceDate: '2025-01-01', residual: 100 }),
      credit({ id: 91, folio: 'R2', invoiceDate: '2026-09-01', residual: 50.5 }),
      credit({ id: 92, folio: 'OTRO', customerId: 99 }),
      inv({}),
    ]
    expect(customerCreditNotes(moves, 24)).toEqual({
      total: 150.5,
      count: 2,
      lines: [
        { id: 91, folio: 'R2', date: '2026-09-01', residual: 50.5, currency: 'MXN' },
        { id: 90, folio: 'R1', date: '2025-01-01', residual: 100, currency: 'MXN' },
      ],
      currencies: [],
    })
  })
})

describe('summarizeCustomers', () => {
  test('una fila por cliente, la mayor deuda primero; la nota de crédito va aparte y NO se resta', () => {
    const rows = summarizeCustomers(
      [customer({ id: 24, name: 'Andritz', daysToPay: 41.6 }), customer({ id: 7, name: 'Bosch', city: null })],
      [
        inv({ id: 1, dueDate: '2026-09-01', residual: 100 }),
        inv({ id: 2, dueDate: '2026-11-01', residual: 40 }),
        credit({ residual: 30 }),
        inv({ id: 3, customerId: 7, customer: 'Bosch', residual: 500 }),
      ],
      ALL,
      TODAY,
    )
    expect(rows.map((r) => r.name)).toEqual(['Bosch', 'Andritz'])
    expect(rows[1]).toEqual({
      id: 24, name: 'Andritz', city: 'Morelia', daysToPay: 41.6,
      overdue: 100, upcoming: 40, total: 140, openInvoices: 2, creditNotes: 30, creditNoteCount: 1, currencies: [],
    })
  })

  test('un cliente facturado que no vino en la lista igual sale (con el nombre de la factura)', () => {
    const rows = summarizeCustomers([], [inv({ customerId: 55, customer: 'FieldCore' }), inv({ id: 2, customerId: 56, customer: null })], ALL, TODAY)
    expect(rows.map((r) => [r.id, r.name, r.total])).toEqual([[55, 'FieldCore', 100], [56, 'Sin nombre', 100]])
  })

  test('empate en saldo → por nombre; customersTotals suma lo mismo que las filas', () => {
    const rows = summarizeCustomers(
      [customer({ id: 2, name: 'Zeta' }), customer({ id: 1, name: 'Alfa' })],
      [inv({ customerId: 2 }), inv({ id: 2, customerId: 1, dueDate: '2026-12-01' }), credit({ customerId: 1, residual: 10 })],
      ALL,
      TODAY,
    )
    expect(rows.map((r) => r.name)).toEqual(['Alfa', 'Zeta'])
    expect(customersTotals(rows)).toEqual({ overdue: 100, upcoming: 100, total: 200, openInvoices: 2, creditNotes: 10, currencies: [] })
  })

  test('otra moneda se suma sin convertir pero queda dicha: en la línea, el estado de cuenta, la fila y los totales (ADR-027 §7)', () => {
    const moves = [
      inv({ id: 1, residual: 100 }),
      inv({ id: 2, folio: 'F-USD', residual: 10, currency: 'USD' }),
      credit({ residual: 5, currency: 'EUR' }),
    ]
    const statement = customerStatement(moves, 24, ALL, TODAY)
    expect(statement.lines.map((l) => [l.folio, l.currency])).toEqual([['F-USD', 'USD'], ['F1', 'MXN']])
    expect(statement.totals.total).toBe(110)
    expect(statement.currencies).toEqual(['USD'])
    expect(customerCreditNotes(moves, 24).currencies).toEqual(['EUR'])
    const rows = summarizeCustomers([customer({})], moves, ALL, TODAY)
    expect(rows[0].currencies).toEqual(['USD', 'EUR'])
    expect(customersTotals(rows).currencies).toEqual(['USD', 'EUR'])
  })
})
