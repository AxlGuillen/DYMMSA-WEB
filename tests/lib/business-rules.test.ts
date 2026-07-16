import { describe, test, expect } from 'vitest'
import {
  isSeparator,
  isProductItem,
  isNotSold,
  filterProductItems,
  calculateLineTotal,
  calculateQuotationTotal,
  calculateOrderTotal,
  calculateDeliveredTotal,
  allocateInventory,
  validateAllocationInvariant,
  receivedForCustomer,
  receptionExcess,
  normalizeCatalogCode,
  catalogKey,
  resolveDymmsaDescription,
} from '@/lib/business-rules'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeQuotationItem(overrides: {
  unit_price?: number | null
  quantity?: number | null
  item_type?: string | null
  is_approved?: boolean | null
  is_sold?: boolean | null
}) {
  return {
    unit_price: 100,
    quantity: 2,
    item_type: 'product' as const,
    is_approved: null,
    ...overrides,
  }
}

function makeOrderItem(overrides: {
  unit_price?: number
  quantity_approved?: number
  quantity_in_stock?: number
  quantity_to_order?: number
  item_type?: string | null
}) {
  return {
    unit_price: 100,
    quantity_approved: 5,
    quantity_in_stock: 0,
    quantity_to_order: 5,
    item_type: 'product' as const,
    ...overrides,
  }
}

// ─── isSeparator ─────────────────────────────────────────────────────────────

describe('isSeparator', () => {
  test('returns true only for item_type === "separator"', () => {
    expect(isSeparator({ item_type: 'separator' })).toBe(true)
  })

  test('returns false for products', () => {
    expect(isSeparator({ item_type: 'product' })).toBe(false)
  })

  test('returns false for null/undefined item_type', () => {
    expect(isSeparator({ item_type: null })).toBe(false)
    expect(isSeparator({})).toBe(false)
  })
})

// ─── isProductItem ───────────────────────────────────────────────────────────

describe('isProductItem', () => {
  test('returns true for item_type === "product"', () => {
    expect(isProductItem({ item_type: 'product' })).toBe(true)
  })

  test('returns true for missing item_type (legacy rows)', () => {
    expect(isProductItem({})).toBe(true)
    expect(isProductItem({ item_type: null })).toBe(true)
    expect(isProductItem({ item_type: undefined })).toBe(true)
  })

  test('returns false for separators', () => {
    expect(isProductItem({ item_type: 'separator' })).toBe(false)
  })
})

// ─── filterProductItems ──────────────────────────────────────────────────────

describe('filterProductItems', () => {
  const items = [
    { item_type: 'product' as const, name: 'A' },
    { item_type: 'separator' as const, name: 'sep1' },
    { item_type: 'product' as const, name: 'B' },
    { item_type: 'separator' as const, name: 'sep2' },
  ]

  test('returns only product items', () => {
    const result = filterProductItems(items)
    expect(result).toHaveLength(2)
    expect(result.every((i) => i.item_type === 'product')).toBe(true)
  })

  test('returns empty array when all are separators', () => {
    expect(filterProductItems([{ item_type: 'separator' }])).toHaveLength(0)
  })

  test('returns all items when none are separators', () => {
    const products = [{ item_type: 'product' }, { item_type: 'product' }]
    expect(filterProductItems(products)).toHaveLength(2)
  })

  test('returns empty array for empty input', () => {
    expect(filterProductItems([])).toHaveLength(0)
  })
})

// ─── calculateLineTotal ──────────────────────────────────────────────────────

describe('calculateLineTotal', () => {
  test('multiplies unit_price × quantity', () => {
    expect(calculateLineTotal(100, 3)).toBe(300)
    expect(calculateLineTotal(12.5, 4)).toBe(50)
  })

  test('returns null when unit_price is null', () => {
    expect(calculateLineTotal(null, 5)).toBeNull()
  })

  test('returns null when quantity is null', () => {
    expect(calculateLineTotal(100, null)).toBeNull()
  })

  test('returns null when both are null', () => {
    expect(calculateLineTotal(null, null)).toBeNull()
  })

  test('returns 0 for zero price or zero quantity', () => {
    expect(calculateLineTotal(0, 10)).toBe(0)
    expect(calculateLineTotal(100, 0)).toBe(0)
  })
})

// ─── calculateQuotationTotal ─────────────────────────────────────────────────

describe('calculateQuotationTotal', () => {
  test('sums unit_price × quantity for all products', () => {
    const items = [
      makeQuotationItem({ unit_price: 100, quantity: 2 }),  // 200
      makeQuotationItem({ unit_price: 50,  quantity: 4 }),  // 200
    ]
    expect(calculateQuotationTotal(items)).toBe(400)
  })

  test('REGLA CRÍTICA: excludes separators from total', () => {
    const items = [
      makeQuotationItem({ unit_price: 100, quantity: 2 }),           // 200
      makeQuotationItem({ item_type: 'separator', unit_price: 999 }), // must be excluded
    ]
    expect(calculateQuotationTotal(items)).toBe(200)
  })

  test('skips items with null unit_price', () => {
    const items = [
      makeQuotationItem({ unit_price: 100, quantity: 3 }),  // 300
      makeQuotationItem({ unit_price: null, quantity: 5 }), // skipped
    ]
    expect(calculateQuotationTotal(items)).toBe(300)
  })

  test('skips items with null quantity', () => {
    const items = [
      makeQuotationItem({ unit_price: 200, quantity: 1 }),  // 200
      makeQuotationItem({ unit_price: 100, quantity: null }), // skipped
    ]
    expect(calculateQuotationTotal(items)).toBe(200)
  })

  test('returns 0 for empty array', () => {
    expect(calculateQuotationTotal([])).toBe(0)
  })

  test('onlyApproved: only sums is_approved === true items', () => {
    const items = [
      makeQuotationItem({ unit_price: 100, quantity: 2, is_approved: true }),  // 200
      makeQuotationItem({ unit_price: 100, quantity: 3, is_approved: false }), // excluded
      makeQuotationItem({ unit_price: 100, quantity: 4, is_approved: null }),  // excluded
    ]
    expect(calculateQuotationTotal(items, { onlyApproved: true })).toBe(200)
  })

  test('onlyApproved: false excludes nothing extra beyond separators', () => {
    const items = [
      makeQuotationItem({ unit_price: 100, quantity: 2, is_approved: null }),  // 200
      makeQuotationItem({ unit_price: 100, quantity: 3, is_approved: false }), // 300
    ]
    // Without onlyApproved flag, both are included
    expect(calculateQuotationTotal(items)).toBe(500)
  })

  test('excluye ítems "no lo vendemos" (is_sold === false)', () => {
    const items = [
      makeQuotationItem({ unit_price: 100, quantity: 2, is_sold: null }),  // 200
      makeQuotationItem({ unit_price: 100, quantity: 5, is_sold: false }), // excluido
      makeQuotationItem({ unit_price: 100, quantity: 1, is_sold: true }),  // 100
    ]
    expect(calculateQuotationTotal(items)).toBe(300)
  })
})

// ─── isNotSold ───────────────────────────────────────────────────────────────

describe('isNotSold', () => {
  test('solo true cuando is_sold === false', () => {
    expect(isNotSold({ is_sold: false })).toBe(true)
    expect(isNotSold({ is_sold: true })).toBe(false)
    expect(isNotSold({ is_sold: null })).toBe(false)
    expect(isNotSold({})).toBe(false)
  })
})

// ─── calculateOrderTotal ─────────────────────────────────────────────────────

describe('calculateOrderTotal', () => {
  test('sums unit_price × quantity_approved for products', () => {
    const items = [
      makeOrderItem({ unit_price: 150, quantity_approved: 3 }), // 450
      makeOrderItem({ unit_price: 50,  quantity_approved: 2 }), // 100
    ]
    expect(calculateOrderTotal(items)).toBe(550)
  })

  test('REGLA CRÍTICA: excludes separators (quantity_approved=0)', () => {
    const items = [
      makeOrderItem({ unit_price: 100, quantity_approved: 5 }),           // 500
      makeOrderItem({ item_type: 'separator', unit_price: 0, quantity_approved: 0 }), // excluded
    ]
    expect(calculateOrderTotal(items)).toBe(500)
  })

  test('returns 0 for empty array', () => {
    expect(calculateOrderTotal([])).toBe(0)
  })
})

// ─── calculateDeliveredTotal ─────────────────────────────────────────────────

describe('calculateDeliveredTotal', () => {
  function makeDeliveredItem(overrides: {
    quantity_in_stock?: number
    quantity_received?: number
    quantity_to_order?: number
    urrea_status?: string
    unit_price?: number
    item_type?: string | null
  }) {
    return {
      quantity_in_stock: 0,
      quantity_received: 0,
      // Default generoso: lo pedido cubre lo recibido (los casos legacy no cambian)
      quantity_to_order: overrides.quantity_to_order ?? overrides.quantity_received ?? 0,
      urrea_status: 'pending',
      unit_price: 100,
      item_type: 'product' as const,
      ...overrides,
    }
  }

  test('sums in_stock + received when status is "pending"', () => {
    const item = makeDeliveredItem({ quantity_in_stock: 3, quantity_received: 2, unit_price: 100 })
    expect(calculateDeliveredTotal([item])).toBe(500)
  })

  test('sums in_stock + received when status is "supplied"', () => {
    const item = makeDeliveredItem({ quantity_in_stock: 2, quantity_received: 3, urrea_status: 'supplied', unit_price: 50 })
    expect(calculateDeliveredTotal([item])).toBe(250)
  })

  test('only counts in_stock when status is "not_supplied"', () => {
    const item = makeDeliveredItem({ quantity_in_stock: 2, quantity_received: 5, urrea_status: 'not_supplied', unit_price: 100 })
    // quantity_received is ignored
    expect(calculateDeliveredTotal([item])).toBe(200)
  })

  test('excludes separators', () => {
    const items = [
      makeDeliveredItem({ quantity_in_stock: 5, unit_price: 100 }),               // 500
      makeDeliveredItem({ item_type: 'separator', quantity_in_stock: 0, unit_price: 0 }), // excluded
    ]
    expect(calculateDeliveredTotal(items)).toBe(500)
  })

  test('returns 0 for empty array', () => {
    expect(calculateDeliveredTotal([])).toBe(0)
  })

  test('REGLA (ADR-019): el excedente NO se factura — cap en lo pedido', () => {
    // in_stock 2 + min(10, 3) = 5 × $100 = $500; los 7 de excedente son stock, no venta
    const item = makeDeliveredItem({
      quantity_in_stock: 2, quantity_received: 10, quantity_to_order: 3, unit_price: 100,
    })
    expect(calculateDeliveredTotal([item])).toBe(500)
  })

  test('not_supplied con excedente sigue ignorando lo recibido', () => {
    const item = makeDeliveredItem({
      quantity_in_stock: 2, quantity_received: 10, quantity_to_order: 3,
      urrea_status: 'not_supplied', unit_price: 100,
    })
    expect(calculateDeliveredTotal([item])).toBe(200)
  })
})

// ─── Recepción con excedente (ADR-019) ──────────────────────────────────────

describe('receivedForCustomer', () => {
  test('recibido menor o igual a lo pedido → recibido', () => {
    expect(receivedForCustomer({ quantity_received: 2, quantity_to_order: 5 })).toBe(2)
    expect(receivedForCustomer({ quantity_received: 5, quantity_to_order: 5 })).toBe(5)
  })
  test('recibido mayor a lo pedido → cap en lo pedido', () => {
    expect(receivedForCustomer({ quantity_received: 10, quantity_to_order: 2 })).toBe(2)
  })
  test('to_order 0 → 0 (todo sería excedente)', () => {
    expect(receivedForCustomer({ quantity_received: 3, quantity_to_order: 0 })).toBe(0)
  })
})

describe('receptionExcess', () => {
  test('ejemplo del issue: 10 recibidos − 2 pedidos → 8 al stock', () => {
    expect(receptionExcess({ quantity_received: 10, quantity_to_order: 2 })).toBe(8)
  })
  test('sin excedente → 0', () => {
    expect(receptionExcess({ quantity_received: 2, quantity_to_order: 5 })).toBe(0)
    expect(receptionExcess({ quantity_received: 5, quantity_to_order: 5 })).toBe(0)
    expect(receptionExcess({ quantity_received: 0, quantity_to_order: 0 })).toBe(0)
  })
})

// ─── allocateInventory ───────────────────────────────────────────────────────

describe('allocateInventory', () => {
  test('INVARIANTE: inStock + toOrder siempre === needed', () => {
    const cases = [
      { needed: 10, available: 15 },
      { needed: 10, available: 5  },
      { needed: 10, available: 0  },
      { needed: 10, available: 10 },
      { needed: 1,  available: 0  },
      { needed: 5,  available: 3  },
    ]
    for (const { needed, available } of cases) {
      const { inStock, toOrder } = allocateInventory(needed, available)
      expect(inStock + toOrder).toBe(needed)
    }
  })

  test('uses all from stock when available >= needed', () => {
    const { inStock, toOrder } = allocateInventory(5, 10)
    expect(inStock).toBe(5)
    expect(toOrder).toBe(0)
  })

  test('uses exactly needed when available === needed', () => {
    const { inStock, toOrder } = allocateInventory(7, 7)
    expect(inStock).toBe(7)
    expect(toOrder).toBe(0)
  })

  test('splits between stock and order when partially covered', () => {
    const { inStock, toOrder } = allocateInventory(10, 4)
    expect(inStock).toBe(4)
    expect(toOrder).toBe(6)
  })

  test('orders everything when no stock available', () => {
    const { inStock, toOrder } = allocateInventory(10, 0)
    expect(inStock).toBe(0)
    expect(toOrder).toBe(10)
  })

  test('inStock is never negative', () => {
    const { inStock } = allocateInventory(5, -3)
    expect(inStock).toBeGreaterThanOrEqual(0)
  })
})

// ─── validateAllocationInvariant ─────────────────────────────────────────────

describe('validateAllocationInvariant', () => {
  test('returns true when invariant holds', () => {
    expect(validateAllocationInvariant({
      quantity_in_stock: 3,
      quantity_to_order: 7,
      quantity_approved: 10,
    })).toBe(true)
  })

  test('returns true for zero quantities (separators)', () => {
    expect(validateAllocationInvariant({
      quantity_in_stock: 0,
      quantity_to_order: 0,
      quantity_approved: 0,
    })).toBe(true)
  })

  test('returns false when invariant is violated', () => {
    expect(validateAllocationInvariant({
      quantity_in_stock: 3,
      quantity_to_order: 5,
      quantity_approved: 10, // 3+5 ≠ 10
    })).toBe(false)
  })

  test('allocateInventory output always satisfies the invariant', () => {
    const needed = 8
    const { inStock, toOrder } = allocateInventory(needed, 3)
    expect(validateAllocationInvariant({
      quantity_in_stock: inStock,
      quantity_to_order: toOrder,
      quantity_approved: needed,
    })).toBe(true)
  })
})

// ─── Descripción DYMMSA (jerarquía de catálogo) ──────────────────────────────

describe('normalizeCatalogCode', () => {
  test('trim + mayúsculas', () => {
    expect(normalizeCatalogCode('  art-123 ')).toBe('ART-123')
    expect(normalizeCatalogCode('abc')).toBe('ABC')
  })

  test('null/undefined/vacío → cadena vacía', () => {
    expect(normalizeCatalogCode(null)).toBe('')
    expect(normalizeCatalogCode(undefined)).toBe('')
    expect(normalizeCatalogCode('   ')).toBe('')
  })
})

describe('catalogKey', () => {
  test('normaliza ambas partes (trim + mayúsculas) y usa URREA si falta marca', () => {
    expect(catalogKey(' art-123 ', ' surtek ')).toBe('SURTEK|ART-123')
    expect(catalogKey('art-123', '')).toBe('URREA|ART-123')
    expect(catalogKey('art-123', null)).toBe('URREA|ART-123')
  })
})

describe('resolveDymmsaDescription', () => {
  // El catálogo se indexa por (marca, código): el MISMO código existe en dos
  // marcas con descripciones distintas — el caso que motivó el match estricto.
  const catalog = new Map<string, string | null>([
    [catalogKey('ART-123', 'URREA'), 'Llave stilson 14" oficial'],
    [catalogKey('TIJS9', 'SURTEK'), 'Tijeras industriales 9-1/2"'],
    [catalogKey('SIN-DESC', 'URREA'), null],
    [catalogKey('DESC-VACIA', 'URREA'), '   '],
  ])

  test('catálogo gana aunque exista curada (jerarquía mayor)', () => {
    const r = resolveDymmsaDescription(
      { item_type: 'product', model_code: 'ART-123', brand: 'URREA', dymmsa_description: 'la curada' },
      catalog,
    )
    expect(r).toEqual({ value: 'Llave stilson 14" oficial', source: 'catalog' })
  })

  test('match es case/espacios-insensible en código Y marca', () => {
    const r = resolveDymmsaDescription(
      { item_type: 'product', model_code: ' art-123 ', brand: ' urrea ', dymmsa_description: null },
      catalog,
    )
    expect(r.source).toBe('catalog')
  })

  test('REGLA: mismo código, otra marca → NO hereda la descripción ajena', () => {
    // TIJS9 solo existe bajo SURTEK. Un producto marcado URREA no debe tomarla
    // (antes sí lo hacía: cruzaba solo por código — ese era el bug).
    const r = resolveDymmsaDescription(
      { item_type: 'product', model_code: 'TIJS9', brand: 'URREA', dymmsa_description: 'curada' },
      catalog,
    )
    expect(r).toEqual({ value: 'curada', source: 'dymmsa' })

    // Con la marca correcta sí resuelve.
    const ok = resolveDymmsaDescription(
      { item_type: 'product', model_code: 'TIJS9', brand: 'SURTEK', dymmsa_description: 'curada' },
      catalog,
    )
    expect(ok).toEqual({ value: 'Tijeras industriales 9-1/2"', source: 'catalog' })
  })

  test('marca vacía → se asume URREA (DEFAULT_BRAND)', () => {
    const r = resolveDymmsaDescription(
      { item_type: 'product', model_code: 'ART-123', brand: '', dymmsa_description: null },
      catalog,
    )
    expect(r.source).toBe('catalog')
  })

  test('sin match de catálogo → curada DYMMSA', () => {
    const r = resolveDymmsaDescription(
      { item_type: 'product', model_code: 'OTRO-COD', brand: 'URREA', dymmsa_description: 'Martillo de uña 16oz' },
      catalog,
    )
    expect(r).toEqual({ value: 'Martillo de uña 16oz', source: 'dymmsa' })
  })

  test('fila de catálogo sin descripción (null o vacía) cede a la curada', () => {
    expect(resolveDymmsaDescription(
      { item_type: 'product', model_code: 'SIN-DESC', brand: 'URREA', dymmsa_description: 'curada' },
      catalog,
    )).toEqual({ value: 'curada', source: 'dymmsa' })
    expect(resolveDymmsaDescription(
      { item_type: 'product', model_code: 'DESC-VACIA', brand: 'URREA', dymmsa_description: 'curada' },
      catalog,
    )).toEqual({ value: 'curada', source: 'dymmsa' })
  })

  test('sin catálogo ni curada → null (celda vacía para el cotizador)', () => {
    const r = resolveDymmsaDescription(
      { item_type: 'product', model_code: 'NADA', brand: 'URREA', dymmsa_description: '  ' },
      catalog,
    )
    expect(r).toEqual({ value: null, source: null })
  })

  test('sin model_code → curada directa', () => {
    const r = resolveDymmsaDescription(
      { item_type: 'product', model_code: '', brand: 'URREA', dymmsa_description: 'curada' },
      catalog,
    )
    expect(r).toEqual({ value: 'curada', source: 'dymmsa' })
  })

  test('separador siempre null (excluido como en todas las reglas)', () => {
    const r = resolveDymmsaDescription(
      { item_type: 'separator', model_code: 'ART-123', brand: 'URREA', dymmsa_description: 'x' },
      catalog,
    )
    expect(r).toEqual({ value: null, source: null })
  })
})
