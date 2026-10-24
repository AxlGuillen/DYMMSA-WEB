/**
 * Order writes that move store_inventory, shared by the order routes (#157): every stock move goes
 * through the atomic DB functions of inventory.ts, and a write that fails gives its reservation back.
 */

import { DomainError } from '@/lib/domain-error'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  allocateLines,
  calculateDeliveredTotal,
  calculateOrderTotal,
  stockDemand,
  stockKey,
} from '@/lib/business-rules'
import { DELIVERY_TIME_LABELS } from '@/lib/delivery'
import {
  canChangeOrderStatus,
  deleteRestoresStock,
  goodsInStore,
  isOrderClosed,
  releaseInventory,
  reserveInventory,
  reservedLines,
  type Reservation,
  type StockLine,
} from '@/lib/inventory'
import { explainPgError, type InspectableItem, type PgErrorInput } from '@/lib/supabase-errors'
import type {
  ConfirmReceptionInput,
  ConfirmReceptionResult,
  CreateOrderInput,
  DeliveryTime,
  OrderItem,
  OrderItemInsert,
  OrderStatus,
  QuotationItem,
  UrreaStatus,
} from '@/types/database'

/** A rule the user broke (400/404), a concurrent change (409) or a write that failed (500); base in domain-error.ts (#155 C1). */
export class OrderError extends DomainError {
  constructor(
    message: string,
    kind: 'invalid' | 'not_found' | 'conflict' | 'failed' = 'invalid',
    readonly offendingEtm?: string,
  ) {
    super(message, kind)
    this.name = 'OrderError'
  }

  /** Response body; the ETM travels when explainPgError names it (ADR-009). */
  override get body(): { message: string; offendingEtm?: string } {
    return this.offendingEtm ? { message: this.message, offendingEtm: this.offendingEtm } : { message: this.message }
  }
}

const CLOSED_MESSAGE = 'No se puede modificar una orden completada o cancelada'
const CONFLICT_MESSAGE = 'La orden cambió mientras se guardaba. Recarga la página y vuelve a intentarlo.'
const DELIVERED_CANCEL_MESSAGE =
  'No se puede cancelar una orden entregada: el material ya salió con el cliente. Si hubo devolución, ajusta el inventario a mano.'
const DELIVERED_ADD_MESSAGE = 'No se pueden agregar productos a una orden entregada: el material ya salió con el cliente.'
const DELIVERED_REMOVE_MESSAGE =
  'No se puede quitar un producto de una orden entregada: ya salió con el cliente. Si hubo devolución, ajusta el inventario a mano.'

type OrderRef = { id: string; status: OrderStatus }
type OrderItemPayload = Omit<OrderItemInsert, 'order_id'>

/** PGRST116 = .single() found no row; anything else is a real failure, not a 404. */
function isNoRow(error: { code?: string } | null): boolean {
  return !error || error.code === 'PGRST116'
}

async function loadOrder(db: SupabaseClient, orderId: string): Promise<OrderRef> {
  const { data, error } = await db.from('orders').select('id, status').eq('id', orderId).single()
  if (data) return data as OrderRef
  if (isNoRow(error)) throw new OrderError('Orden no encontrada', 'not_found')
  console.error(`[orders] read error orderId=${orderId}`, error)
  throw new OrderError('Error al leer la orden', 'failed')
}

async function loadOrderItem(db: SupabaseClient, orderId: string, itemId: string): Promise<{ order: OrderRef; item: OrderItem }> {
  const order = await loadOrder(db, orderId)
  if (isOrderClosed(order.status)) throw new OrderError(CLOSED_MESSAGE)
  const { data: item, error } = await db.from('order_items').select('*').eq('id', itemId).eq('order_id', orderId).single()
  if (item) return { order, item: item as OrderItem }
  if (isNoRow(error)) throw new OrderError('Producto no encontrado', 'not_found')
  console.error(`[orders] item read error itemId=${itemId}`, error)
  throw new OrderError('Error al leer el producto', 'failed')
}

function poolOf(reservations: ReadonlyMap<string, Reservation>): Map<string, number> {
  return new Map([...reservations].map(([code, r]) => [code, r.reserved]))
}

/** Gives a reservation back after the write that needed it failed; a failure here can only be logged. */
async function giveBack(db: SupabaseClient, reservations: ReadonlyMap<string, Reservation>, tag: string): Promise<void> {
  try {
    await releaseInventory(db, reservedLines(reservations))
  } catch (error) {
    console.error(`[${tag}] could not return the reserved stock`, reservedLines(reservations), error)
  }
}

/** Undoes a half-created order: stock back first, then the order (its items go by CASCADE). */
async function rollbackOrder(
  db: SupabaseClient,
  orderId: string,
  reservations: ReadonlyMap<string, Reservation>,
  tag: string,
): Promise<void> {
  await giveBack(db, reservations, tag)
  const { error } = await db.from('orders').delete().eq('id', orderId)
  if (error) console.error(`[${tag}] rollback could not delete orderId=${orderId}`, error)
}

async function reserveOrRollback(
  db: SupabaseClient,
  orderId: string,
  lines: StockLine[],
  tag: string,
): Promise<Map<string, Reservation>> {
  try {
    return await reserveInventory(db, lines)
  } catch (error) {
    console.error(`[${tag}] reserve error rolling back orderId=${orderId}`, error)
    await rollbackOrder(db, orderId, new Map(), tag)
    throw new OrderError('Error al apartar el inventario de la orden', 'failed')
  }
}

/** explainPgError → OrderError (ADR-009); `fallback` replaces the raw DB message of a non-rule failure. */
function pgOrderError(error: PgErrorInput | null, items?: InspectableItem[], fallback?: string): OrderError {
  const info = explainPgError(error, items)
  if (info.isConstraintViolation) return new OrderError(info.userMessage, 'invalid', info.offendingEtm)
  return new OrderError(fallback ?? info.userMessage, 'failed', info.offendingEtm)
}

/** The key a DB order function raised on purpose (P0001), or undefined for any other error. */
function ruleKey(error: { code?: string; message?: string }): string | undefined {
  return error.code === 'P0001' ? error.message : undefined
}

/** Approved total after a line changes. Logged, not thrown: the line write already happened and a retry would repeat it. */
async function recalculateOrderTotal(db: SupabaseClient, orderId: string): Promise<number | null> {
  const { data, error } = await db
    .from('order_items')
    .select('unit_price, quantity_approved, item_type')
    .eq('order_id', orderId)
    .limit(5000)
  if (error) {
    console.error(`[order-total] read error orderId=${orderId}`, error)
    return null
  }
  const total = calculateOrderTotal(data ?? [])
  const { error: updateError } = await db.from('orders').update({ total_amount: total }).eq('id', orderId)
  if (updateError) console.error(`[order-total] update error orderId=${orderId}`, updateError)
  return total
}

// ─── Create ─────────────────────────────────────────────────────────────────

export interface CreatedOrder {
  order_id: string
  items_count: number
  total_amount: number
}

/** Order from an approved quotation: separators + approved sold products, stock reserved per model_code. */
export async function createOrderFromQuotation(db: SupabaseClient, quotationId: string, userId: string): Promise<CreatedOrder> {
  const tag = 'create-order'
  const { data: quotation, error: fetchError } = await db
    .from('quotations')
    .select('*, quotation_items(*)')
    .eq('id', quotationId)
    .limit(5000, { foreignTable: 'quotation_items' })
    .single()

  if (fetchError || !quotation) {
    console.error(`[${tag}] quotation not found id=${quotationId} dbError=${fetchError?.message}`)
    throw new OrderError('Cotización no encontrada', 'not_found')
  }
  if (quotation.status !== 'approved') {
    throw new OrderError('Solo se puede generar una orden a partir de una cotización aprobada')
  }

  const allItems = (quotation.quotation_items as QuotationItem[]).slice().sort((a, b) => a.sort_order - b.sort_order)
  // is_sold === false never reaches the order or the URREA Excel; defense in depth, it should not be approved either.
  const products = allItems
    .filter((i) => (i.item_type === 'product' || !i.item_type) && i.is_approved === true && i.is_sold !== false)
    .map((item) => ({ item, model_code: item.model_code, quantity: item.quantity ?? 1, unitPrice: item.unit_price ?? 0 }))

  if (products.length === 0) throw new OrderError('No hay productos aprobados en esta cotización')

  const totalAmount = calculateOrderTotal(
    products.map((p) => ({ unit_price: p.unitPrice, quantity_approved: p.quantity, item_type: 'product' })),
  )

  const { data: order, error: orderError } = await db
    .from('orders')
    .insert({
      quotation_id: quotationId,
      name: quotation.name,
      customer_name: quotation.customer_name,
      status: 'ordered',
      total_amount: totalAmount,
      created_by: userId,
    })
    .select()
    .single()

  if (orderError || !order) {
    console.error(`[${tag}] order insert error quotationId=${quotationId}`, orderError)
    // A concurrent second click loses on orders_quotation_id_unique before touching stock (ADR-010).
    const info = explainPgError(orderError)
    throw info.isConstraintViolation ? new OrderError(info.userMessage) : new OrderError('Error al crear la orden', 'failed')
  }

  const reservations = await reserveOrRollback(db, order.id, stockDemand(products), tag)
  const allocations = allocateLines(products, poolOf(reservations))
  const allocationById = new Map(products.map((p, i) => [p.item.id, { product: p, allocation: allocations[i] }]))

  let sortIndex = 0
  const payload: OrderItemPayload[] = []
  for (const item of allItems) {
    if (item.item_type === 'separator') {
      payload.push({
        sort_order: sortIndex++,
        item_type: 'separator',
        section_label: item.section_label ?? null,
        separator_color: item.separator_color ?? null,
        etm: '',
        model_code: '',
        description: '',
        brand: '',
        quantity_approved: 0,
        quantity_in_stock: 0,
        quantity_to_order: 0,
        quantity_received: 0,
        urrea_status: 'pending',
        delivery_time: 'immediate',
        unit_price: 0,
      })
      continue
    }
    const entry = allocationById.get(item.id)
    if (!entry) continue
    const key = stockKey(item.model_code)
    payload.push({
      sort_order: sortIndex++,
      item_type: 'product',
      section_label: null,
      etm: item.etm || '',
      model_code: item.model_code || '',
      description: item.description || item.description_es || '',
      brand: item.brand || '',
      quantity_approved: entry.product.quantity,
      quantity_in_stock: entry.allocation.inStock,
      quantity_to_order: entry.allocation.toOrder,
      quantity_received: 0,
      urrea_status: 'pending',
      delivery_time: item.delivery_time || 'immediate',
      unit_price: entry.product.unitPrice,
      location: key ? reservations.get(key)?.location ?? null : null,
    })
  }

  const { error: itemsError } = await db.from('order_items').insert(payload.map((i) => ({ ...i, order_id: order.id })))
  if (itemsError) {
    console.error(`[${tag}] items insert error rolling back orderId=${order.id}`, itemsError)
    await rollbackOrder(db, order.id, reservations, tag)
    throw pgOrderError(itemsError, payload)
  }

  // A linked order behind an 'approved' quotation would be a dead end (ADR-010).
  const { error: statusError } = await db.from('quotations').update({ status: 'converted_to_order' }).eq('id', quotationId)
  if (statusError) {
    console.error(`[${tag}] status update error rolling back orderId=${order.id}`, statusError)
    await rollbackOrder(db, order.id, reservations, tag)
    throw new OrderError('Error al crear la orden', 'failed')
  }

  console.log(`[${tag}] DONE orderId=${order.id} items=${products.length} total=${totalAmount}`)
  return { order_id: order.id, items_count: products.length, total_amount: totalAmount }
}

export interface CreatedManualOrder {
  order_id: string
  customer_name: string
  total_amount: number
  items_count: number
  items_to_order: number
  inventory_updated: number
}

/** Manual order from the green rows of an approved Excel; same reservation as createOrderFromQuotation. */
export async function createManualOrder(db: SupabaseClient, input: CreateOrderInput, userId: string): Promise<CreatedManualOrder> {
  const tag = 'create-manual-order'
  if (!input?.customer_name || !input.products?.length) {
    throw new OrderError('Nombre de cliente y productos son requeridos')
  }

  const lines = input.products.map((product) => ({ product, model_code: product.model_code, quantity: product.quantity || 1 }))
  const totalAmount = calculateOrderTotal(
    lines.map((l) => ({ unit_price: l.product.price, quantity_approved: l.quantity, item_type: 'product' })),
  )

  const { data: order, error: orderError } = await db
    .from('orders')
    .insert({ customer_name: input.customer_name, status: 'ordered', total_amount: totalAmount, created_by: userId })
    .select()
    .single()

  if (orderError || !order) {
    console.error('Error creating order:', orderError)
    throw new OrderError('Error al crear orden', 'failed')
  }

  const reservations = await reserveOrRollback(db, order.id, stockDemand(lines), tag)
  const allocations = allocateLines(lines, poolOf(reservations))

  const orderItems: OrderItemPayload[] = lines.map(({ product, quantity }, sortIndex) => ({
    item_type: 'product',
    section_label: null,
    etm: product.etm,
    model_code: product.model_code,
    description: product.description || product.description_es || '',
    brand: product.brand || '',
    quantity_approved: quantity,
    quantity_in_stock: allocations[sortIndex].inStock,
    quantity_to_order: allocations[sortIndex].toOrder,
    quantity_received: 0,
    urrea_status: 'pending',
    delivery_time: 'immediate',
    unit_price: product.price,
    sort_order: sortIndex,
  }))

  const { error: itemsError } = await db.from('order_items').insert(orderItems.map((i) => ({ ...i, order_id: order.id })))
  if (itemsError) {
    console.error('Error creating order items:', itemsError)
    await rollbackOrder(db, order.id, reservations, tag)
    throw pgOrderError(itemsError, orderItems)
  }

  return {
    order_id: order.id,
    customer_name: order.customer_name,
    total_amount: totalAmount,
    items_count: orderItems.length,
    items_to_order: orderItems.filter((i) => i.quantity_to_order > 0).length,
    inventory_updated: reservedLines(reservations).length,
  }
}

// ─── Cancel / delete ────────────────────────────────────────────────────────

/** Cancels and returns the stock in ONE transaction, guarded by the status read (#157): a retry restores nothing.
 *  The DB reads what to give back under the order lock, so a line removed meanwhile is never returned twice. */
export async function cancelOrder(db: SupabaseClient, orderId: string): Promise<{ restored: number }> {
  const order = await loadOrder(db, orderId)
  if (order.status === 'cancelled') throw new OrderError('Orden ya está cancelada')
  if (order.status === 'completed') throw new OrderError('No se puede cancelar una orden completada')
  if (!goodsInStore(order.status)) throw new OrderError(DELIVERED_CANCEL_MESSAGE)

  const { data, error } = await db.rpc('cancel_order_restock', { p_order_id: orderId, p_expected_status: order.status })
  if (error) {
    console.error(`[cancel-order] error orderId=${orderId}`, error)
    throw new OrderError('Error al cancelar orden', 'failed')
  }
  if (data == null) throw new OrderError(CONFLICT_MESSAGE, 'conflict')
  return { restored: Number(data) }
}

/** Deletes the order (items, cut plan and decisions by CASCADE) and, while in store, returns its stock atomically. */
export async function deleteOrder(db: SupabaseClient, orderId: string): Promise<void> {
  const order = await loadOrder(db, orderId)
  const { data, error } = await db.rpc('delete_order_restock', {
    p_order_id: orderId,
    p_expected_status: order.status,
    // Restoring a cancelled order again would duplicate its stock (ADR-010).
    p_restock: deleteRestoresStock(order.status),
  })
  if (error) {
    console.error(`[delete-order] error orderId=${orderId}`, error)
    throw new OrderError('Error al eliminar la orden', 'failed')
  }
  if (data == null) throw new OrderError(CONFLICT_MESSAGE, 'conflict')
}

// ─── Status ─────────────────────────────────────────────────────────────────

// 'cancelled' only through /cancel: it is the one that returns the stock, and DELETE relies on it (ADR-010).
export const MANUAL_ORDER_STATUSES: readonly OrderStatus[] = ['ordered', 'received', 'delivered', 'completed']

/** Manual status change, guarded by the status read; never back into the store once delivered (#157). */
export async function setOrderStatus(db: SupabaseClient, orderId: string, body: unknown): Promise<unknown> {
  const status = (body as { status?: unknown } | null)?.status
  if (status === 'cancelled') {
    throw new OrderError('Para cancelar usa "Cancelar orden": es la que restaura el inventario')
  }
  if (!MANUAL_ORDER_STATUSES.includes(status as OrderStatus)) throw new OrderError('Estado inválido')
  const to = status as OrderStatus

  const order = await loadOrder(db, orderId)
  if (order.status === 'cancelled') throw new OrderError('Una orden cancelada ya no cambia de estado')
  if (!canChangeOrderStatus(order.status, to)) {
    throw new OrderError('La orden ya se entregó: no puede regresar a Pedida ni a Recibida')
  }

  const { data, error } = await db
    .from('orders')
    .update({ status: to })
    .eq('id', orderId)
    .eq('status', order.status)
    .select()
    .single()
  if (data) return data
  if (isNoRow(error)) throw new OrderError(CONFLICT_MESSAGE, 'conflict')
  console.error('Update order status error:', error)
  throw new OrderError('Error al actualizar el estado', 'failed')
}

// ─── Lines ──────────────────────────────────────────────────────────────────

/** Adds a line in ONE transaction (add_order_item): the order stays locked while its stock is reserved,
 *  so a concurrent cancel either sees the line and returns its stock, or the add fails (#157). */
export async function addOrderItem(
  db: SupabaseClient,
  orderId: string,
  body: unknown,
): Promise<{ item: unknown; total_amount: number | null }> {
  const order = await loadOrder(db, orderId)
  if (isOrderClosed(order.status)) throw new OrderError(CLOSED_MESSAGE)
  if (!goodsInStore(order.status)) throw new OrderError(DELIVERED_ADD_MESSAGE)

  const raw = (body ?? {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const quantity = raw.quantity_approved
  const unitPrice = raw.unit_price
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    throw new OrderError('La cantidad debe ser un número entero mayor a 0')
  }
  if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new OrderError('El precio no puede ser negativo')
  }

  const item = {
    etm: text(raw.etm),
    description: text(raw.description),
    model_code: text(raw.model_code),
    brand: text(raw.brand),
    unit_price: unitPrice,
    quantity_approved: quantity,
  }
  const { data, error } = await db.rpc('add_order_item', { p_order_id: orderId, p_item: item })
  if (error) {
    switch (ruleKey(error)) {
      case 'order_not_found':
        throw new OrderError('Orden no encontrada', 'not_found')
      case 'order_closed':
        throw new OrderError(CLOSED_MESSAGE)
      case 'order_delivered':
        throw new OrderError(DELIVERED_ADD_MESSAGE)
    }
    console.error(`[add-order-item] error orderId=${orderId}`, error)
    throw pgOrderError(error, [item], 'Error al agregar el producto')
  }

  return { item: data, total_amount: await recalculateOrderTotal(db, orderId) }
}

const DELIVERY_TIMES = Object.keys(DELIVERY_TIME_LABELS) as DeliveryTime[]

/** Price and/or delivery time of a line; no stock moves, so a delivered order still allows it. */
export async function updateOrderItem(
  db: SupabaseClient,
  orderId: string,
  itemId: string,
  body: unknown,
): Promise<{ total_amount: number | null } | { success: true }> {
  await loadOrderItem(db, orderId, itemId)

  const raw = (body ?? {}) as Record<string, unknown>
  const updates: { unit_price?: number; delivery_time?: DeliveryTime } = {}
  if (raw.unit_price != null) {
    if (typeof raw.unit_price !== 'number' || !Number.isFinite(raw.unit_price) || raw.unit_price < 0) {
      throw new OrderError('Precio inválido')
    }
    updates.unit_price = raw.unit_price
  }
  if (raw.delivery_time != null) {
    if (!DELIVERY_TIMES.includes(raw.delivery_time as DeliveryTime)) throw new OrderError('Tiempo de entrega inválido')
    updates.delivery_time = raw.delivery_time as DeliveryTime
  }
  if (Object.keys(updates).length === 0) throw new OrderError('Sin cambios')

  const { error } = await db.from('order_items').update(updates).eq('id', itemId).eq('order_id', orderId)
  if (error) {
    console.error(`[edit-order-item] update error itemId=${itemId}`, error)
    throw pgOrderError(error, undefined, 'Error al actualizar el producto')
  }

  if (updates.unit_price !== undefined) return { total_amount: await recalculateOrderTotal(db, orderId) }
  return { success: true }
}

/** Removes a line and returns the stock it took in ONE transaction (#157); never on a delivered order. */
export async function removeOrderItem(
  db: SupabaseClient,
  orderId: string,
  itemId: string,
): Promise<{ total_amount: number | null }> {
  const { order } = await loadOrderItem(db, orderId, itemId)
  if (!goodsInStore(order.status)) throw new OrderError(DELIVERED_REMOVE_MESSAGE)

  // The DB gives back only what the line took from stock, read from the row it deletes.
  const { data, error } = await db.rpc('remove_order_item_restock', {
    p_order_id: orderId,
    p_item_id: itemId,
    p_expected_status: order.status,
  })
  if (error) {
    console.error(`[remove-order-item] error itemId=${itemId}`, error)
    throw new OrderError('Error al quitar el producto', 'failed')
  }
  if (data == null) throw new OrderError(CONFLICT_MESSAGE, 'conflict')

  return { total_amount: await recalculateOrderTotal(db, orderId) }
}

// ─── Reception ──────────────────────────────────────────────────────────────

const URREA_STATUSES: readonly UrreaStatus[] = ['pending', 'supplied', 'not_supplied']
const NOT_IN_ORDER_MESSAGE = 'Uno de los productos de la recepción no pertenece a esta orden'

type ReceptionLine = ConfirmReceptionInput['items'][number]

/** Shape only; membership, URREA order and status are checked by the DB inside the reception transaction. */
function parseReceptionItems(input: unknown): ReceptionLine[] {
  const items = (input as { items?: unknown } | null)?.items
  if (!Array.isArray(items) || items.length === 0) throw new OrderError('Items requeridos')
  for (const item of items) {
    if (typeof item !== 'object' || item === null || typeof (item as { id?: unknown }).id !== 'string') {
      throw new OrderError('Cada producto de la recepción necesita su id')
    }
    const { quantity_received, urrea_status } = item as Partial<ReceptionLine>
    if (typeof quantity_received !== 'number' || !Number.isInteger(quantity_received) || quantity_received < 0) {
      throw new OrderError('La cantidad recibida debe ser un entero mayor o igual a 0')
    }
    if (!URREA_STATUSES.includes(urrea_status as UrreaStatus)) throw new OrderError('Estado de envío inválido')
  }
  const lines = items as ReceptionLine[]
  if (new Set(lines.map((l) => l.id)).size !== lines.length) {
    throw new OrderError('Un producto viene repetido en la recepción')
  }
  return lines.map(({ id, quantity_received, urrea_status }) => ({ id, quantity_received, urrea_status }))
}

/** The P0001 keys receive_order_items() raises, as the user reads them. */
function receptionError(error: { code?: string; message?: string; details?: string | null }): OrderError {
  switch (ruleKey(error)) {
    case 'order_not_found':
      return new OrderError('Orden no encontrada', 'not_found')
    case 'order_closed':
      return new OrderError(CLOSED_MESSAGE)
    case 'duplicate_item':
      return new OrderError('Un producto viene repetido en la recepción')
    case 'item_not_in_order':
      return new OrderError(NOT_IN_ORDER_MESSAGE)
    case 'item_not_ordered':
      return new OrderError(`${error.details || 'Una línea'}: no se pidió a URREA (salió completo de stock), así que no lleva recepción`)
  }
  // A malformed id is a bad request, not a server failure.
  if (error.code === '22P02') return new OrderError(NOT_IN_ORDER_MESSAGE)
  return pgOrderError(error, undefined, 'Error al confirmar recepción')
}

type ReceptionWarning = { tag?: unknown; model_code?: unknown; kind?: unknown }

function warningText(w: ReceptionWarning): string {
  return w.kind === 'missing'
    ? `${w.tag}: no existe fila de inventario de ${w.model_code} para restar la corrección del excedente.`
    : `${w.tag}: la corrección dejaría el stock en negativo; se ajustó a 0 (revisa el inventario de ${w.model_code}).`
}

/** URREA reception (ADR-019): only the EXCESS enters inventory, as a DELTA — re-confirming is idempotent.
 *  Lines and stock commit in ONE transaction (receive_order_items): a failed inventory write loses nothing (#157). */
export async function confirmReception(
  db: SupabaseClient,
  orderId: string,
  input: ConfirmReceptionInput,
): Promise<ConfirmReceptionResult> {
  const items = parseReceptionItems(input)

  const { data, error } = await db.rpc('receive_order_items', { p_order_id: orderId, p_items: items })
  if (error) {
    if (error.code !== 'P0001') console.error(`[confirm-reception] error orderId=${orderId}`, error)
    throw receptionError(error)
  }
  const result = (data ?? {}) as { inventory_updated?: unknown; warnings?: unknown }
  const warnings = Array.isArray(result.warnings) ? (result.warnings as ReceptionWarning[]).map(warningText) : []

  // Total = in_stock (already reserved) + min(received, ordered) unless not_supplied; excess is never billed.
  const { data: allItems, error: totalReadError } = await db
    .from('order_items')
    .select('quantity_in_stock, quantity_received, quantity_to_order, urrea_status, unit_price, item_type')
    .eq('order_id', orderId)
    .limit(5000)
  if (totalReadError) {
    console.error(`[confirm-reception] total read error orderId=${orderId}`, totalReadError)
  } else {
    const { error: totalError } = await db
      .from('orders')
      .update({ total_amount: calculateDeliveredTotal(allItems ?? []) })
      .eq('id', orderId)
    if (totalError) console.error(`[confirm-reception] total update error orderId=${orderId}`, totalError)
  }

  return { success: true, inventory_updated: Number(result.inventory_updated) || 0, warnings }
}
