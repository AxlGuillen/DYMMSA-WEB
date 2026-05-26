import { describe, test, expect } from 'bun:test'
import {
  isEligibleForAutoLearn,
  computeNewEtmFields,
  mergeEtmFields,
} from '@/lib/auto-learn'
import type { QuotationItemRow } from '@/types/database'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<QuotationItemRow> = {}): QuotationItemRow {
  return {
    _id:            'test-id',
    item_type:      'product',
    section_label:  '',
    etm:            'ETM-001',
    description:    'Test product',
    description_es: 'Producto de prueba',
    model_code:     'MC001',
    brand:          'URREA',
    unit_price:     100,
    quantity:       5,
    delivery_time:  'immediate',
    _inDb:          false,
    is_approved:    null,
    ...overrides,
  }
}

function makeExisting(overrides: Partial<{
  etm: string
  description: string
  description_es: string
  model_code: string
  price: number
  brand: string
}> = {}) {
  return {
    etm:            'ETM-001',
    description:    'Existing description',
    description_es: 'Descripción existente',
    model_code:     'MC001',
    price:          80,
    brand:          'URREA',
    ...overrides,
  }
}

// ─── isEligibleForAutoLearn ──────────────────────────────────────────────────

describe('isEligibleForAutoLearn', () => {
  test('eligible: product with etm + model_code', () => {
    expect(isEligibleForAutoLearn(makeItem())).toBe(true)
  })

  test('eligible: product with etm + description (no model_code)', () => {
    expect(isEligibleForAutoLearn(makeItem({ model_code: '' }))).toBe(true)
  })

  test('NOT eligible: etm + description_es only (no description, no model_code)', () => {
    expect(isEligibleForAutoLearn(makeItem({
      model_code:  '',
      description: '',
      description_es: 'Solo descripción ES',
    }))).toBe(false) // description is checked, not description_es — isEligible checks description only
  })

  test('NOT eligible: separator item', () => {
    expect(isEligibleForAutoLearn(makeItem({ item_type: 'separator', etm: 'SEP-01' }))).toBe(false)
  })

  test('NOT eligible: empty etm', () => {
    expect(isEligibleForAutoLearn(makeItem({ etm: '' }))).toBe(false)
  })

  test('NOT eligible: has etm but no model_code AND no description', () => {
    expect(isEligibleForAutoLearn(makeItem({
      etm:         'ETM-001',
      model_code:  '',
      description: '',
    }))).toBe(false)
  })

  test('NOT eligible: has etm + model_code but is separator', () => {
    expect(isEligibleForAutoLearn(makeItem({ item_type: 'separator' }))).toBe(false)
  })
})

// ─── computeNewEtmFields ─────────────────────────────────────────────────────

describe('computeNewEtmFields', () => {
  test('maps all fields from item correctly', () => {
    const item = makeItem({
      etm:            'ETM-XYZ',
      description:    'Desc EN',
      description_es: 'Desc ES',
      model_code:     'MC-100',
      unit_price:     250,
      brand:          'URREA',
    })
    // Cast needed since computeNewEtmFields expects EligibleItem (etm truthy)
    const result = computeNewEtmFields(item as Parameters<typeof computeNewEtmFields>[0])

    expect(result.etm).toBe('ETM-XYZ')
    expect(result.description).toBe('Desc EN')
    expect(result.description_es).toBe('Desc ES')
    expect(result.model_code).toBe('MC-100')
    expect(result.price).toBe(250)
    expect(result.brand).toBe('URREA')
  })

  test('REGLA CRÍTICA: brand defaults to "URREA" when model_code is present and brand is empty', () => {
    const item = makeItem({ brand: '', model_code: 'MC-500' })
    const result = computeNewEtmFields(item as Parameters<typeof computeNewEtmFields>[0])
    expect(result.brand).toBe('URREA')
  })

  test('REGLA CRÍTICA: brand is null when model_code is empty (no brand assumption)', () => {
    const item = makeItem({ brand: '', model_code: '' })
    const result = computeNewEtmFields(item as Parameters<typeof computeNewEtmFields>[0])
    expect(result.brand).toBeNull()
  })

  test('keeps explicit brand when set (non-URREA)', () => {
    const item = makeItem({ brand: 'TRUPER', model_code: 'TC-001' })
    const result = computeNewEtmFields(item as Parameters<typeof computeNewEtmFields>[0])
    expect(result.brand).toBe('TRUPER')
  })

  test('price defaults to 0 when unit_price is null', () => {
    const item = makeItem({ unit_price: null })
    const result = computeNewEtmFields(item as Parameters<typeof computeNewEtmFields>[0])
    expect(result.price).toBe(0)
  })

  test('empty description falls back to empty string (not undefined)', () => {
    const item = makeItem({ description: '', description_es: '' })
    const result = computeNewEtmFields(item as Parameters<typeof computeNewEtmFields>[0])
    expect(result.description).toBe('')
    expect(result.description_es).toBe('')
  })
})

// ─── mergeEtmFields ──────────────────────────────────────────────────────────

describe('mergeEtmFields', () => {
  test('hasChanges is false when no field changed', () => {
    const existing = makeExisting()
    const incoming = makeItem({
      description:    existing.description,
      description_es: existing.description_es,
      model_code:     existing.model_code,
      brand:          existing.brand,
      unit_price:     existing.price,
    })
    const { hasChanges } = mergeEtmFields(existing, incoming as Parameters<typeof mergeEtmFields>[1])
    expect(hasChanges).toBe(false)
  })

  test('includes changed description in updates', () => {
    const existing = makeExisting({ description: 'Old description' })
    const incoming = makeItem({ description: 'New description' })
    const { updates, hasChanges } = mergeEtmFields(existing, incoming as Parameters<typeof mergeEtmFields>[1])
    expect(hasChanges).toBe(true)
    expect(updates.description).toBe('New description')
  })

  test('REGLA CRÍTICA: does NOT update with empty string (never overwrites with blank)', () => {
    const existing = makeExisting({ description: 'Has description' })
    const incoming = makeItem({ description: '' })
    const { updates } = mergeEtmFields(existing, incoming as Parameters<typeof mergeEtmFields>[1])
    expect(updates.description).toBeUndefined()
  })

  test('REGLA CRÍTICA: does NOT update description_es with empty string', () => {
    const existing = makeExisting({ description_es: 'Descripción existente' })
    const incoming = makeItem({ description_es: '' })
    const { updates } = mergeEtmFields(existing, incoming as Parameters<typeof mergeEtmFields>[1])
    expect(updates.description_es).toBeUndefined()
  })

  test('REGLA CRÍTICA: does NOT update model_code with empty string', () => {
    const existing = makeExisting({ model_code: 'MC-EXISTING' })
    const incoming = makeItem({ model_code: '' })
    const { updates } = mergeEtmFields(existing, incoming as Parameters<typeof mergeEtmFields>[1])
    expect(updates.model_code).toBeUndefined()
  })

  test('updates price when changed and non-null', () => {
    const existing = makeExisting({ price: 100 })
    const incoming = makeItem({ unit_price: 150 })
    const { updates, hasChanges } = mergeEtmFields(existing, incoming as Parameters<typeof mergeEtmFields>[1])
    expect(hasChanges).toBe(true)
    expect(updates.price).toBe(150)
  })

  test('does NOT update price when incoming unit_price is null', () => {
    const existing = makeExisting({ price: 100 })
    const incoming = makeItem({ unit_price: null })
    const { updates } = mergeEtmFields(existing, incoming as Parameters<typeof mergeEtmFields>[1])
    expect(updates.price).toBeUndefined()
  })

  test('updates multiple fields at once', () => {
    const existing = makeExisting({ description: 'Old EN', model_code: 'OLD-MC' })
    const incoming = makeItem({ description: 'New EN', model_code: 'NEW-MC' })
    const { updates, hasChanges } = mergeEtmFields(existing, incoming as Parameters<typeof mergeEtmFields>[1])
    expect(hasChanges).toBe(true)
    expect(updates.description).toBe('New EN')
    expect(updates.model_code).toBe('NEW-MC')
  })
})
