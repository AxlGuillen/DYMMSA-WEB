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

/**
 * Item marcado como "no lo vendemos" (`is_sold === false`).
 * Se excluye de totales, Excel URREA, órdenes y validación de guardado.
 * `null` (sin definir) y `true` (lo vendemos) NO cuentan como no-vendible.
 */
export function isNotSold(item: { is_sold?: boolean | null }): boolean {
  return item.is_sold === false
}

// ─── Descripción DYMMSA (jerarquía de catálogo) ────────────────────────

/**
 * Normaliza la llave de cruce entre `etm_products.model_code` y
 * `urrea_catalog.code`: trim + mayúsculas. Debe aplicarse en TODOS los
 * caminos de escritura del catálogo y al armar lookups — un espacio o
 * minúscula hace fallar el match en silencio.
 */
export function normalizeCatalogCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase()
}

/** Marca por defecto del catálogo/sistema (etm_products.brand y urrea_catalog.brand). */
export const DEFAULT_BRAND = 'URREA'

/**
 * Normaliza la marca (trim + mayúsculas) — misma disciplina que el código, para
 * que el cruce `(model_code, brand)` no falle en silencio por casing/espacios.
 * Vacío → `DEFAULT_BRAND` (la columna es NOT NULL DEFAULT 'URREA').
 */
export function normalizeCatalogBrand(brand: string | null | undefined): string {
  return (brand ?? '').trim().toUpperCase() || DEFAULT_BRAND
}

/**
 * Llave de cruce con `urrea_catalog`: **código + marca**, ambos normalizados.
 *
 * La identidad del catálogo es `UNIQUE(code, brand)` — el mismo código puede
 * existir en varias marcas (URREA maneja varias líneas), así que cruzar solo
 * por código puede traer la descripción de OTRA marca. Es la llave de los
 * mapas de `fetchCatalogDescriptionMap` y de `resolveDymmsaDescription`.
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
 * Resuelve la "Descripción DYMMSA" de un ítem con jerarquía de catálogo:
 *
 *   1. Catálogo oficial (match por `model_code` + `brand`, ambos normalizados)
 *      — gana siempre; no se puede tapar con la curada (si está mal, se corrige
 *      reimportando el catálogo).
 *   2. Curada DYMMSA (`dymmsa_description`) — solo productos sin catálogo.
 *   3. `null` — celda vacía para que el cotizador la llene.
 *
 * El match es ESTRICTO por (código, marca): un producto marcado URREA cuyo
 * código solo existe bajo SURTEK ya NO hereda esa descripción — antes sí, y esa
 * era la fuente del bug. Marca vacía → `DEFAULT_BRAND` (ver normalizeCatalogBrand).
 *
 * `source` permite a la UI etiquetar el origen y deshabilitar la edición
 * cuando la descripción viene del catálogo. Separadores siempre `null`.
 *
 * @param catalogMap  Map<catalogKey(code, brand), descripción> (batch por cotización)
 */
export function resolveDymmsaDescription(
  item: DescriptionResolvable,
  catalogMap: Map<string, string | null>,
): { value: string | null; source: DymmsaDescriptionSource } {
  if (!isProductItem(item)) return { value: null, source: null }

  if (normalizeCatalogCode(item.model_code)) {
    const catalogDesc = catalogMap.get(catalogKey(item.model_code, item.brand))
    // Solo gana si el catálogo trae descripción real; una fila sin descripción
    // no aporta nada oficial y cede el turno a la curada.
    if (catalogDesc && catalogDesc.trim() !== '') {
      return { value: catalogDesc.trim(), source: 'catalog' }
    }
  }

  const curated = item.dymmsa_description?.trim()
  if (curated) return { value: curated, source: 'dymmsa' }

  return { value: null, source: null }
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
  is_sold?: boolean | null
}

/**
 * Total de una cotización. Excluye separadores, ítems "no lo vendemos"
 * (`is_sold === false`) e ítems sin precio o cantidad.
 *
 * @param options.onlyApproved  Si true, solo suma ítems con `is_approved === true`
 */
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
 * Suma `quantity_in_stock + min(recibido, pedido)` (si URREA no marcó
 * "no suministrado"), multiplicado por `unit_price`. El EXCEDENTE de
 * recepción nunca se factura — es stock de tienda, no venta (ADR-019).
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

/**
 * Porción de lo recibido que corresponde al cliente (facturable/entregable):
 * `min(recibido, pedido)`. El excedente no se cobra ni aparece en el formato
 * de entrega — la aprobación ya fijó qué compra el cliente.
 */
export function receivedForCustomer<T extends ReceptionLike>(item: T): number {
  return Math.min(item.quantity_received, item.quantity_to_order)
}

/**
 * Excedente de recepción: `max(0, recibido − pedido)`. Es lo ÚNICO que entra
 * a `store_inventory` al confirmar recepción (por delta — re-confirmar es
 * idempotente). Independiente de `urrea_status`.
 */
export function receptionExcess<T extends ReceptionLike>(item: T): number {
  return Math.max(0, item.quantity_received - item.quantity_to_order)
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
