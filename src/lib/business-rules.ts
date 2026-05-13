/**
 * Reglas de negocio críticas como funciones puras.
 *
 * Estas funciones encodan las reglas del CLAUDE.md y deben ser la única
 * fuente de verdad para cálculos de totales, separadores e inventario.
 *
 * Reglas críticas implementadas:
 * - Separadores (`item_type='separator'`) excluidos de totales y conteos
 * - Invariante de allocation: in_stock + to_order = approved
 * - Stock deducido al CREAR la orden, no al confirmar recepción
 */

// ─── Tipos de ítem ─────────────────────────────────────────────────────

/**
 * Item es separador si su `item_type` es explícitamente 'separator'.
 */
export function isSeparator(item: { item_type?: string | null }): boolean {
  return item.item_type === 'separator'
}

/**
 * Item es producto si no tiene `item_type` definido (legacy) o es 'product'.
 * Cualquier otro valor (incluido 'separator') retorna false.
 */
export function isProductItem(item: { item_type?: string | null }): boolean {
  return !item.item_type || item.item_type === 'product'
}

/**
 * Filtra solo ítems de tipo producto, excluyendo separadores.
 */
export function filterProductItems<T extends { item_type?: string | null }>(items: T[]): T[] {
  return items.filter(isProductItem)
}

// ─── Cálculos de líneas ────────────────────────────────────────────────

/**
 * Calcula el subtotal de una línea: unit_price * quantity.
 * Retorna `null` si falta cualquiera de los dos.
 */
export function calculateLineTotal(
  unitPrice: number | null | undefined,
  quantity: number | null | undefined
): number | null {
  if (unitPrice == null || quantity == null) return null
  return unitPrice * quantity
}

// ─── Totales de cotización ─────────────────────────────────────────────

type QuotationItemLike = {
  unit_price: number | null
  quantity: number | null
  item_type?: string | null
  is_approved?: boolean | null
}

/**
 * Total de una cotización. Excluye separadores e ítems sin precio o cantidad.
 *
 * @param options.onlyApproved  Si true, solo suma ítems con `is_approved === true`
 */
export function calculateQuotationTotal<T extends QuotationItemLike>(
  items: T[],
  options: { onlyApproved?: boolean } = {}
): number {
  return items.reduce((sum, item) => {
    if (!isProductItem(item)) return sum
    if (item.unit_price == null || item.quantity == null) return sum
    if (options.onlyApproved && item.is_approved !== true) return sum
    return sum + item.unit_price * item.quantity
  }, 0)
}

// ─── Totales de orden ──────────────────────────────────────────────────

type OrderItemLike = {
  unit_price: number
  quantity_approved: number
  item_type?: string | null
}

/**
 * Total de una orden. Suma `unit_price * quantity_approved` para todos los
 * ítems de tipo producto. Separadores excluidos.
 */
export function calculateOrderTotal<T extends OrderItemLike>(items: T[]): number {
  return items.reduce((sum, item) => {
    if (!isProductItem(item)) return sum
    return sum + item.unit_price * item.quantity_approved
  }, 0)
}

/**
 * Total real entregado al cliente, usado en confirm-reception.
 * Suma `quantity_in_stock + quantity_received` (si URREA no marcó "no suministrado"),
 * multiplicado por `unit_price`.
 */
export function calculateDeliveredTotal<T extends {
  quantity_in_stock: number
  quantity_received: number
  urrea_status: string
  unit_price: number
  item_type?: string | null
}>(items: T[]): number {
  return items.reduce((sum, item) => {
    if (!isProductItem(item)) return sum
    let qty = item.quantity_in_stock
    if (item.urrea_status !== 'not_supplied') {
      qty += item.quantity_received
    }
    return sum + qty * item.unit_price
  }, 0)
}

// ─── Inventario / Allocation ───────────────────────────────────────────

/**
 * Reparte una cantidad necesaria entre stock disponible y por pedir.
 *
 * Invariante garantizado: inStock + toOrder === needed
 *
 * @param needed     Cantidad solicitada (aprobada)
 * @param available  Stock disponible en `store_inventory`
 */
export function allocateInventory(
  needed: number,
  available: number
): { inStock: number; toOrder: number } {
  const inStock = Math.max(0, Math.min(needed, available))
  const toOrder = needed - inStock
  return { inStock, toOrder }
}

/**
 * Valida el invariante crítico del CLAUDE.md:
 * `quantity_in_stock + quantity_to_order === quantity_approved`
 *
 * Útil para asserts en routes que mutan order_items.
 */
export function validateAllocationInvariant(item: {
  quantity_in_stock: number
  quantity_to_order: number
  quantity_approved: number
}): boolean {
  return item.quantity_in_stock + item.quantity_to_order === item.quantity_approved
}
