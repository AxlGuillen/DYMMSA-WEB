/**
 * Reglas de negocio críticas como funciones puras — la única fuente de verdad
 * ejecutable de totales, separadores, descripción DYMMSA e inventario.
 * La narrativa de cada regla vive en CLAUDE.md ("Reglas de negocio críticas").
 */

// ─── Tipos de ítem ─────────────────────────────────────────────────────

export function isSeparator(item: { item_type?: string | null }): boolean {
  return item.item_type === 'separator'
}

/** Producto = sin `item_type` (legacy) o 'product'; cualquier otro valor no lo es. */
export function isProductItem(item: { item_type?: string | null }): boolean {
  return !item.item_type || item.item_type === 'product'
}

export function filterProductItems<T extends { item_type?: string | null }>(items: T[]): T[] {
  return items.filter(isProductItem)
}

/** "No lo vendemos" = SOLO `is_sold === false` (tri-estado: null/true no excluyen). */
export function isNotSold(item: { is_sold?: boolean | null }): boolean {
  return item.is_sold === false
}

// ─── Descripción DYMMSA (jerarquía de catálogo, ADR-013) ───────────────

/** Llave de cruce con urrea_catalog: trim+upper SIEMPRE — un espacio rompe el match en silencio. */
export function normalizeCatalogCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase()
}

/** Marca por defecto del catálogo/sistema (etm_products.brand y urrea_catalog.brand). */
export const DEFAULT_BRAND = 'URREA'

/** Marca normalizada trim+upper; vacía → DEFAULT_BRAND (la columna es NOT NULL DEFAULT). */
export function normalizeCatalogBrand(brand: string | null | undefined): string {
  return (brand ?? '').trim().toUpperCase() || DEFAULT_BRAND
}

/** Marca como ETIQUETA (proveedores, #21): trim+upper SIN default — vacía es inválida, no URREA. */
export function normalizeBrandTag(name: string | null | undefined): string {
  return (name ?? '').trim().toUpperCase()
}

/**
 * Llave `marca|código` para los mapas de catálogo. El cruce es SIEMPRE por
 * (code, brand): el mismo código existe en varias marcas (ADR-013).
 */
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

/**
 * Jerarquía: catálogo oficial (por code+brand estricto) > curada > null.
 * `source` deja a la UI etiquetar el origen y bloquear la edición de la oficial.
 */
export function resolveDymmsaDescription(
  item: DescriptionResolvable,
  catalogMap: Map<string, string | null>,
): { value: string | null; source: DymmsaDescriptionSource } {
  if (!isProductItem(item)) return { value: null, source: null }

  if (normalizeCatalogCode(item.model_code)) {
    const catalogDesc = catalogMap.get(catalogKey(item.model_code, item.brand))
    // Una fila de catálogo sin descripción no aporta nada oficial: cede a la curada.
    if (catalogDesc && catalogDesc.trim() !== '') {
      return { value: catalogDesc.trim(), source: 'catalog' }
    }
  }

  const curated = item.dymmsa_description?.trim()
  if (curated) return { value: curated, source: 'dymmsa' }

  return { value: null, source: null }
}

// ─── Cálculos de líneas ────────────────────────────────────────────────

/** Subtotal de línea; null si falta precio o cantidad. */
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
  is_sold?: boolean | null
}

/** Total de cotización: fuera separadores, "no lo vendemos" y líneas incompletas. */
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

/**
 * Subtotal EN VIVO de `/approve/[token]`: la aprobación es el set local de ids
 * que el cliente marca, no el campo persistido. Mismas exclusiones que el total.
 */
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

// ─── Totales de orden ──────────────────────────────────────────────────

type OrderItemLike = {
  unit_price: number
  quantity_approved: number
  item_type?: string | null
}

/** Total de orden: precio × cantidad aprobada, separadores fuera. */
export function calculateOrderTotal<T extends OrderItemLike>(items: T[]): number {
  return items.reduce((sum, item) => {
    if (!isProductItem(item)) return sum
    return sum + item.unit_price * item.quantity_approved
  }, 0)
}

/**
 * Total real entregado (confirm-reception): stock + min(recibido, pedido).
 * El excedente de recepción nunca se factura (ADR-019).
 */
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

// ─── Recepción con excedente (ADR-019) ─────────────────────────────────

type ReceptionLike = {
  quantity_received: number
  quantity_to_order: number
}

/** Lo facturable/entregable de una recepción: min(recibido, pedido). */
export function receivedForCustomer<T extends ReceptionLike>(item: T): number {
  return Math.min(item.quantity_received, item.quantity_to_order)
}

/** Excedente = max(0, recibido − pedido): lo ÚNICO que entra a inventario (por delta). */
export function receptionExcess<T extends ReceptionLike>(item: T): number {
  return Math.max(0, item.quantity_received - item.quantity_to_order)
}

// ─── Inventario / Allocation ───────────────────────────────────────────

/** Reparte lo aprobado entre stock y por pedir. Invariante: inStock + toOrder === needed. */
export function allocateInventory(
  needed: number,
  available: number
): { inStock: number; toOrder: number } {
  const inStock = Math.max(0, Math.min(needed, available))
  const toOrder = needed - inStock
  return { inStock, toOrder }
}

/** Assert del invariante in_stock + to_order === approved (routes que mutan order_items). */
export function validateAllocationInvariant(item: {
  quantity_in_stock: number
  quantity_to_order: number
  quantity_approved: number
}): boolean {
  return item.quantity_in_stock + item.quantity_to_order === item.quantity_approved
}
