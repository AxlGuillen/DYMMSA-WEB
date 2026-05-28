/**
 * Fixtures reutilizables para tests de route handlers.
 * Centralizadas para evitar drift entre archivos (un solo lugar que cambiar
 * si el shape de un item de cotización/orden evoluciona).
 */

/** Usuario autenticado estándar. */
export const AUTH = { id: 'user-1' } as const

/** Item de cotización tipo 'product' (payload de quotations/save y update). */
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

/** Item separador (payload de quotations/save y update). */
export function separator(overrides: Record<string, unknown> = {}) {
  return { _id: 's1', item_type: 'separator', section_label: 'Sección A', ...overrides }
}

/** Producto para orders/create (usa `price`, no `unit_price`). */
export function orderProduct(overrides: Record<string, unknown> = {}) {
  return {
    model_code: 'MC1', quantity: 4, price: 100,
    etm: 'E1', brand: 'URREA', description: 'P',
    ...overrides,
  }
}
