import { describe, test, expect } from 'vitest'
import { computeRestoration } from '@/lib/inventory'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<{
  model_code: string | null
  quantity_in_stock: number
  quantity_received: number
}> = {}) {
  return {
    model_code:        'MC-001',
    quantity_in_stock: 0,
    quantity_received: 0,
    ...overrides,
  }
}

// ─── computeRestoration ───────────────────────────────────────────────────────

describe('computeRestoration', () => {
  test('sums quantity_in_stock + quantity_received', () => {
    const items = [makeItem({ quantity_in_stock: 3, quantity_received: 2 })]
    const result = computeRestoration(items)
    expect(result).toHaveLength(1)
    expect(result[0].quantityToRestore).toBe(5)
    expect(result[0].model_code).toBe('MC-001')
  })

  test('excludes items with null model_code', () => {
    const items = [
      makeItem({ model_code: null, quantity_in_stock: 5, quantity_received: 2 }),
      makeItem({ model_code: 'MC-002', quantity_in_stock: 3, quantity_received: 0 }),
    ]
    const result = computeRestoration(items)
    expect(result).toHaveLength(1)
    expect(result[0].model_code).toBe('MC-002')
  })

  test('REGLA CRÍTICA: excludes items where quantityToRestore === 0', () => {
    const items = [
      makeItem({ model_code: 'MC-001', quantity_in_stock: 0, quantity_received: 0 }),
      makeItem({ model_code: 'MC-002', quantity_in_stock: 2, quantity_received: 1 }),
    ]
    const result = computeRestoration(items)
    expect(result).toHaveLength(1)
    expect(result[0].model_code).toBe('MC-002')
    expect(result[0].quantityToRestore).toBe(3)
  })

  test('excludes items where both in_stock and received are 0', () => {
    const items = [makeItem({ quantity_in_stock: 0, quantity_received: 0 })]
    expect(computeRestoration(items)).toHaveLength(0)
  })

  test('includes item when only quantity_in_stock > 0', () => {
    const items = [makeItem({ quantity_in_stock: 4, quantity_received: 0 })]
    const result = computeRestoration(items)
    expect(result).toHaveLength(1)
    expect(result[0].quantityToRestore).toBe(4)
  })

  test('includes item when only quantity_received > 0', () => {
    const items = [makeItem({ quantity_in_stock: 0, quantity_received: 7 })]
    const result = computeRestoration(items)
    expect(result).toHaveLength(1)
    expect(result[0].quantityToRestore).toBe(7)
  })

  test('REGLA CRÍTICA: does NOT merge duplicate model_codes (DB handles that)', () => {
    const items = [
      makeItem({ model_code: 'MC-001', quantity_in_stock: 3, quantity_received: 0 }),
      makeItem({ model_code: 'MC-001', quantity_in_stock: 2, quantity_received: 1 }),
    ]
    const result = computeRestoration(items)
    // Two separate entries — not merged
    expect(result).toHaveLength(2)
    expect(result[0].quantityToRestore).toBe(3)
    expect(result[1].quantityToRestore).toBe(3)
  })

  test('handles mixed items: some valid, some filtered', () => {
    const items = [
      makeItem({ model_code: null,    quantity_in_stock: 5, quantity_received: 0 }), // excluded: null code
      makeItem({ model_code: 'MC-A',  quantity_in_stock: 0, quantity_received: 0 }), // excluded: zero qty
      makeItem({ model_code: 'MC-B',  quantity_in_stock: 2, quantity_received: 3 }), // included: 5
      makeItem({ model_code: 'MC-C',  quantity_in_stock: 1, quantity_received: 0 }), // included: 1
    ]
    const result = computeRestoration(items)
    expect(result).toHaveLength(2)
    expect(result.find((r) => r.model_code === 'MC-B')?.quantityToRestore).toBe(5)
    expect(result.find((r) => r.model_code === 'MC-C')?.quantityToRestore).toBe(1)
  })

  test('returns empty array for empty input', () => {
    expect(computeRestoration([])).toHaveLength(0)
  })

  test('returns empty array when all items are filtered out', () => {
    const items = [
      makeItem({ model_code: null, quantity_in_stock: 5 }),
      makeItem({ model_code: 'MC-X', quantity_in_stock: 0, quantity_received: 0 }),
    ]
    expect(computeRestoration(items)).toHaveLength(0)
  })

  test('works with extra fields (generic T extends RestorableItem)', () => {
    const items = [
      {
        model_code:        'MC-999',
        quantity_in_stock: 3,
        quantity_received: 1,
        item_type:         'product',     // extra field
        some_other_field:  'ignored',     // extra field
      },
    ]
    const result = computeRestoration(items)
    expect(result).toHaveLength(1)
    expect(result[0].model_code).toBe('MC-999')
    expect(result[0].quantityToRestore).toBe(4)
  })
})
