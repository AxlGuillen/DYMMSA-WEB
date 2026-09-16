/** Shared fixtures for route-handler tests: one place to change when a shape evolves. */

/** Default authenticated user. */
export const AUTH = { id: 'user-1' } as const

/** Quotation 'product' item (payload of quotations/save and update). */
export function quotationItem(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'i' + Math.random().toString(36).slice(2, 6),
    item_type: 'product',
    etm: 'ETM-1', description: 'Producto', description_es: 'Producto',
    model_code: 'MC1', brand: 'URREA', unit_price: 100, quantity: 2,
    delivery_time: 'immediate',
    ...overrides,
  }
}

/** Separator item (payload of quotations/save and update). */
export function separator(overrides: Record<string, unknown> = {}) {
  return { _id: 's1', item_type: 'separator', section_label: 'Sección A', ...overrides }
}

/** Product for orders/create (uses `price`, not `unit_price`). */
export function orderProduct(overrides: Record<string, unknown> = {}) {
  return {
    model_code: 'MC1', quantity: 4, price: 100,
    etm: 'E1', brand: 'URREA', description: 'P',
    ...overrides,
  }
}
