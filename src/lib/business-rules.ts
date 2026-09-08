/** Executable source of truth for the critical business rules; the narrative lives in CLAUDE.md. */

export function isSeparator(item: { item_type?: string | null }): boolean {
  return item.item_type === 'separator'
}

/** Product = missing `item_type` (legacy) or 'product'. */
export function isProductItem(item: { item_type?: string | null }): boolean {
  return !item.item_type || item.item_type === 'product'
}

export function filterProductItems<T extends { item_type?: string | null }>(items: T[]): T[] {
  return items.filter(isProductItem)
}

/** "Not sold" = ONLY `is_sold === false`; the tri-state null/true never exclude. */
export function isNotSold(item: { is_sold?: boolean | null }): boolean {
  return item.is_sold === false
}

/** ALWAYS trim+upper: a stray space breaks the catalog match silently. */
export function normalizeCatalogCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase()
}

/** Default brand for etm_products.brand and urrea_catalog.brand. */
export const DEFAULT_BRAND = 'URREA'

/** trim+upper; empty → DEFAULT_BRAND (the column is NOT NULL DEFAULT). */
export function normalizeCatalogBrand(brand: string | null | undefined): string {
  return (brand ?? '').trim().toUpperCase() || DEFAULT_BRAND
}

/** Brand as a TAG (suppliers, #21): trim+upper with NO default — empty is invalid, not URREA. */
export function normalizeBrandTag(name: string | null | undefined): string {
  return (name ?? '').trim().toUpperCase()
}

/** The catalog cross is ALWAYS by (code, brand): the same code exists under several brands (ADR-013). */
export function catalogKey(
  code: string | null | undefined,
  brand: string | null | undefined,
): string {
  return `${normalizeCatalogBrand(brand)}|${normalizeCatalogCode(code)}`
}

export type DymmsaDescriptionSource = 'catalog' | 'dymmsa' | null

type DescriptionResolvable = {
  item_type?: string | null
  model_code?: string | null
  brand?: string | null
  dymmsa_description?: string | null
}

/** Hierarchy: official catalog (strict code+brand) > curated > null. `source` lets the UI label
 *  the origin and lock the official one. */
export function resolveDymmsaDescription(
  item: DescriptionResolvable,
  catalogMap: Map<string, string | null>,
): { value: string | null; source: DymmsaDescriptionSource } {
  if (!isProductItem(item)) return { value: null, source: null }

  if (normalizeCatalogCode(item.model_code)) {
    const catalogDesc = catalogMap.get(catalogKey(item.model_code, item.brand))
    // A catalog row with no description offers nothing official: fall back to curated.
    if (catalogDesc && catalogDesc.trim() !== '') {
      return { value: catalogDesc.trim(), source: 'catalog' }
    }
  }

  const curated = item.dymmsa_description?.trim()
  if (curated) return { value: curated, source: 'dymmsa' }

  return { value: null, source: null }
}

/** Line subtotal; null when price or quantity is missing. */
export function calculateLineTotal(
  unitPrice: number | null | undefined,
  quantity: number | null | undefined
): number | null {
  if (unitPrice == null || quantity == null) return null
  return unitPrice * quantity
}

type QuotationItemLike = {
  unit_price: number | null
  quantity: number | null
  item_type?: string | null
  is_approved?: boolean | null
  is_sold?: boolean | null
}

/** Excludes separators, "not sold" items and incomplete lines. */
export function calculateQuotationTotal<T extends QuotationItemLike>(
  items: T[],
  options: { onlyApproved?: boolean } = {}
): number {
  return items.reduce((sum, item) => {
    if (!isProductItem(item)) return sum
    if (isNotSold(item)) return sum
    if (item.unit_price == null || item.quantity == null) return sum
    if (options.onlyApproved && item.is_approved !== true) return sum
    return sum + item.unit_price * item.quantity
  }, 0)
}

/** LIVE subtotal for `/approve/[token]`: approval is the client's local id set, not the persisted
 *  field. Same exclusions as the total. */
export function calculateApprovedSubtotal<T extends QuotationItemLike & { id: string }>(
  items: T[],
  approvedIds: ReadonlySet<string>,
): number {
  return items.reduce((sum, item) => {
    if (!isProductItem(item)) return sum
    if (isNotSold(item)) return sum
    if (!approvedIds.has(item.id)) return sum
    return sum + (calculateLineTotal(item.unit_price, item.quantity) ?? 0)
  }, 0)
}

type OrderItemLike = {
  unit_price: number
  quantity_approved: number
  item_type?: string | null
}

/** Price × approved quantity; separators excluded. */
export function calculateOrderTotal<T extends OrderItemLike>(items: T[]): number {
  return items.reduce((sum, item) => {
    if (!isProductItem(item)) return sum
    return sum + item.unit_price * item.quantity_approved
  }, 0)
}

/** Delivered total: stock + min(received, ordered) — reception excess is never invoiced (ADR-019). */
export function calculateDeliveredTotal<T extends {
  quantity_in_stock: number
  quantity_received: number
  quantity_to_order: number
  urrea_status: string
  unit_price: number
  item_type?: string | null
}>(items: T[]): number {
  return items.reduce((sum, item) => {
    if (!isProductItem(item)) return sum
    let qty = item.quantity_in_stock
    if (item.urrea_status !== 'not_supplied') {
      qty += receivedForCustomer(item)
    }
    return sum + qty * item.unit_price
  }, 0)
}

type ReceptionLike = {
  quantity_received: number
  quantity_to_order: number
}

/** Invoiceable/deliverable part of a reception: min(received, ordered). */
export function receivedForCustomer<T extends ReceptionLike>(item: T): number {
  return Math.min(item.quantity_received, item.quantity_to_order)
}

/** Excess = max(0, received − ordered): the ONLY thing that enters inventory, by delta. */
export function receptionExcess<T extends ReceptionLike>(item: T): number {
  return Math.max(0, item.quantity_received - item.quantity_to_order)
}

/** Splits approved between stock and to-order. Invariant: inStock + toOrder === needed. */
export function allocateInventory(
  needed: number,
  available: number
): { inStock: number; toOrder: number } {
  const inStock = Math.max(0, Math.min(needed, available))
  const toOrder = needed - inStock
  return { inStock, toOrder }
}

/** Invariant check for routes that mutate order_items. */
export function validateAllocationInvariant(item: {
  quantity_in_stock: number
  quantity_to_order: number
  quantity_approved: number
}): boolean {
  return item.quantity_in_stock + item.quantity_to_order === item.quantity_approved
}
