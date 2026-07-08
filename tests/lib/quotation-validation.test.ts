import { describe, test, expect } from 'vitest'
import {
  validateQuotationItems,
  getBlockingIssues,
  getErrorItemIds,
} from '@/lib/quotation-validation'
import type { QuotationItemRow } from '@/types/database'

function row(overrides: Partial<QuotationItemRow> = {}): QuotationItemRow {
  return {
    _id: 'r' + Math.random().toString(36).slice(2, 6),
    item_type: 'product',
    section_label: '',
    etm: 'ETM-1',
    description: 'P',
    description_es: 'P',
    model_code: 'MC1',
    brand: 'URREA',
    unit_price: 100,
    quantity: 2,
    delivery_time: 'immediate',
    _inDb: true,
    is_approved: null,
    ...overrides,
  }
}

describe('validateQuotationItems', () => {
  test('items válidos → sin issues', () => {
    expect(validateQuotationItems([row()])).toEqual([])
  })

  test('ítem "no lo vendemos" (is_sold=false) queda exento aunque falten datos', () => {
    // Sin cantidad, sin precio y hasta sin ETM: no debe generar ningún issue.
    const issues = validateQuotationItems([
      row({ is_sold: false, quantity: null, unit_price: null, etm: '', model_code: '' }),
    ])
    expect(issues).toEqual([])
  })

  test('is_sold true/null SÍ se validan como siempre', () => {
    expect(getBlockingIssues([row({ is_sold: true, quantity: 0 })]).length).toBeGreaterThan(0)
    expect(getBlockingIssues([row({ is_sold: null, quantity: 0 })]).length).toBeGreaterThan(0)
  })

  test('quantity 0 → error con ETM en el mensaje', () => {
    const issues = validateQuotationItems([row({ etm: 'BAD', quantity: 0 })])
    expect(issues).toHaveLength(1)
    expect(issues[0].field).toBe('quantity')
    expect(issues[0].severity).toBe('error')
    expect(issues[0].etm).toBe('BAD')
    expect(issues[0].message).toContain('BAD')
    expect(issues[0].message).toMatch(/mayor a 0/i)
  })

  test('quantity null → error', () => {
    const issues = validateQuotationItems([row({ quantity: null })])
    expect(issues.some((i) => i.field === 'quantity')).toBe(true)
  })

  test('quantity negativa → error', () => {
    const issues = validateQuotationItems([row({ quantity: -1 })])
    expect(issues.some((i) => i.field === 'quantity')).toBe(true)
  })

  test('unit_price negativo → error', () => {
    const issues = validateQuotationItems([row({ etm: 'NEG', unit_price: -5 })])
    expect(issues).toHaveLength(1)
    expect(issues[0].field).toBe('unit_price')
    expect(issues[0].message).toContain('NEG')
    expect(issues[0].message).toMatch(/negativo/i)
  })

  test('unit_price null → OK (permitido)', () => {
    expect(validateQuotationItems([row({ unit_price: null })])).toEqual([])
  })

  test('etm vacío → error sin ETM en el mensaje', () => {
    const issues = validateQuotationItems([row({ etm: '' })])
    expect(issues[0].field).toBe('etm')
    expect(issues[0].etm).toBeNull()
    expect(issues[0].message).toMatch(/sin ETM/i)
  })

  test('model_code vacío → WARNING (no bloquea)', () => {
    const issues = validateQuotationItems([row({ model_code: '' })])
    expect(issues).toHaveLength(1)
    expect(issues[0].field).toBe('model_code')
    expect(issues[0].severity).toBe('warning')
  })

  test('separadores se ignoran', () => {
    const sep = row({ item_type: 'separator', quantity: null, unit_price: null, etm: '', model_code: '' })
    expect(validateQuotationItems([sep])).toEqual([])
  })

  test('NO valida ETMs duplicados (es comportamiento intencional)', () => {
    const items = [
      row({ etm: 'DUP-1', _id: 'r1' }),
      row({ etm: 'DUP-1', _id: 'r2' }),
    ]
    expect(validateQuotationItems(items)).toEqual([])
  })

  test('múltiples errores: reporta todos por orden de aparición', () => {
    const items = [
      row({ etm: 'OK-1' }),
      row({ etm: 'Q0', quantity: 0 }),
      row({ etm: 'NEG', unit_price: -1 }),
      row({ etm: 'OK-2' }),
    ]
    const issues = validateQuotationItems(items)
    expect(issues.map((i) => i.etm)).toEqual(['Q0', 'NEG'])
  })

  test('onlyApproved: filtra a is_approved=true', () => {
    const items = [
      row({ etm: 'YES', quantity: 0, is_approved: true }),       // error
      row({ etm: 'NO', quantity: 0, is_approved: false }),       // ignorado
      row({ etm: 'PEND', quantity: 0, is_approved: null }),      // ignorado
    ]
    const issues = validateQuotationItems(items, { onlyApproved: true })
    expect(issues.map((i) => i.etm)).toEqual(['YES'])
  })
})

describe('getBlockingIssues', () => {
  test('descarta warnings', () => {
    const items = [
      row({ etm: 'OK', model_code: '' }),                      // warning
      row({ etm: 'BAD', quantity: 0 }),                        // error
    ]
    const blocking = getBlockingIssues(items)
    expect(blocking).toHaveLength(1)
    expect(blocking[0].severity).toBe('error')
  })
})

describe('getErrorItemIds', () => {
  test('devuelve Set de _id con errores', () => {
    const items = [
      row({ _id: 'a', quantity: 0 }),       // error
      row({ _id: 'b' }),                    // OK
      row({ _id: 'c', unit_price: -1 }),    // error
    ]
    const ids = getErrorItemIds(items)
    expect(ids.has('a')).toBe(true)
    expect(ids.has('b')).toBe(false)
    expect(ids.has('c')).toBe(true)
    expect(ids.size).toBe(2)
  })
})
