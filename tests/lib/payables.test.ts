/**
 * Finanzas (issue #84): vencimiento desde el plazo del proveedor y resumen
 * del mes. El reloj SIEMPRE va por parámetro — nada lee new Date().
 */

import { describe, test, expect } from 'vitest'
import { daysUntilDue, dueDateFrom, monthOf, nextMonth, summarizeMonth } from '@/lib/payables'
import type { Payable } from '@/types/database'

function payable(overrides: Partial<Payable> = {}): Payable {
  return {
    id: `p-${Math.random().toString(36).slice(2, 7)}`,
    supplier_id: 's1',
    concept: 'Factura',
    amount: 100,
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
      payable({ due_date: '2026-09-03', amount: 100 }),  // semana 1, vencida (hoy=10)
      payable({ due_date: '2026-09-12', amount: 200 }),  // semana 2, por vencer ≤7d
      payable({ due_date: '2026-09-25', amount: 300 }),  // semana 4
      payable({ due_date: '2026-08-20', amount: 50 }),   // vencida de AGOSTO: overdue sí, mes no
    ]
    const s = summarizeMonth(rows, month, today)

    expect(s.pendingTotal).toBe(600)     // solo las que VENCEN en septiembre
    expect(s.pendingCount).toBe(3)
    expect(s.overdueTotal).toBe(150)     // 100 (sep 3) + 50 (agosto arrastrada)
    expect(s.overdueCount).toBe(2)
    expect(s.dueSoonTotal).toBe(200)     // vence el 12, hoy es 10
    expect(s.weeks.map((w) => [w.week, w.total])).toEqual([[1, 100], [2, 200], [4, 300]])
  })

  test('pagadas cuentan por MES DE PAGO real, no de vencimiento', () => {
    const rows = [
      payable({ status: 'paid', due_date: '2026-08-31', paid_at: '2026-09-02', amount: 400 }),
      payable({ status: 'paid', due_date: '2026-09-05', paid_at: '2026-10-01', amount: 999 }), // pagada en octubre
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
    // El bug que motivo el helper: `${month}-31` es fecha invalida en los meses
    // cortos y Postgres responde 22008, tumbando el overview de septiembre.
    expect(nextMonth('2026-09')).toBe('2026-10-01')
    expect(nextMonth('2026-02')).toBe('2026-03-01')
  })

  test('cruza el ano en diciembre', () => {
    expect(nextMonth('2026-12')).toBe('2027-01-01')
  })
})
