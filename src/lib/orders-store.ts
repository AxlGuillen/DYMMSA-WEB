/**
 * Order writes that move store_inventory, shared by the order routes (#157): every stock move goes
 * through the atomic DB functions of inventory.ts, and a write that fails gives its reservation back.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  allocateLines,
  calculateDeliveredTotal,
  calculateOrderTotal,
  receptionExcess,
  stockDemand,
  stockKey,
} from '@/lib/business-rules'
import { DELIVERY_TIME_LABELS } from '@/lib/delivery'
import {
  adjustInventory,
  deleteRestoresStock,
  goodsInStore,
  isOrderClosed,
  releaseInventory,
  reserveInventory,
  reservedLines,
  restorationLines,
  type Reservation,
  type StockLine,
} from '@/lib/inventory'
import { explainPgError, type PgErrorInput } from '@/lib/supabase-errors'
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

type OrderErrorKind = 'invalid' | 'not_found' | 'conflict' | 'failed'

const STATUS_BY_KIND: Record<OrderErrorKind, number> = { invalid: 400, not_found: 404, conflict: 409, failed: 500 }

/** A rule the user broke (400/404), a concurrent change (409) or a write that failed (500). */
export class OrderError extends Error {
  constructor(
    message: string,
    readonly kind: OrderErrorKind = 'invalid',
    readonly offendingEtm?: string,
  ) {
    super(message)
    this.name = 'OrderError'
  }

  get status(): number {
    return STATUS_BY_KIND[this.kind]
  }

  /** Response body; the ETM travels when explainPgError names it (ADR-009). */
  get body(): { message: string; offendingEtm?: string } {
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

async function loadOrder(db: SupabaseClient, orderId: string): Promise<OrderRef> {
  const { data } = await db.from('orders').select('id, status').eq('id', orderId).single()
  if (!data) throw new OrderError('Orden no encontrada', 'not_found')
  return data as OrderRef
}

async function loadOrderItem(db: SupabaseClient, orderId: string, itemId: string): Promise<{ order: OrderRef; item: OrderItem }> {
  const order = await loadOrder(db, orderId)
  if (isOrderClosed(order.status)) throw new OrderError(CLOSED_MESSAGE)
  const { data: item } = await db.from('order_items').select('*').eq('id', itemId).eq('order_id', orderId).single()
  if (!item) throw new OrderError('Producto no encontrado', 'not_found')
  return { order, item: item as OrderItem }
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
function pgOrderError(error: PgErrorInput | null, items?: OrderItemPayload[], fallback?: string): OrderError {
  const info = explainPgError(error, items)
  if (info.isConstraintViolation) return new OrderError(info.userMessage, 'invalid', info.offendingEtm)
  return new OrderError(fallback ?? info.userMessage, 'failed', info.offendingEtm)
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

async function loadRestorationLines(db: SupabaseClient, orderId: string): Promise<StockLine[]> {
  const { data, error } = await db
    .from('order_items')
    .select('model_code, quantity_in_stock, quantity_received, quantity_to_order')
    .eq('order_id', orderId)
    .limit(5000)
  if (error) {
    console.error(`[order-restock] items read error orderId=${orderId}`, error)
    throw new OrderError('Error al leer los productos de la orden', 'failed')
  }
  return restorationLines(data ?? [])
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

/** Cancels and returns the stock in ONE transaction, guarded by the status read (#157): a retry restores nothing. */
export async function cancelOrder(db: SupabaseClient, orderId: string): Promise<{ restored: number }> {
  const order = await loadOrder(db, orderId)
  if (order.status === 'cancelled') throw new OrderError('Orden ya está cancelada')
  if (order.status === 'completed') throw new OrderError('No se puede cancelar una orden completada')
  if (!goodsInStore(order.status)) throw new OrderError(DELIVERED_CANCEL_MESSAGE)

  const lines = await loadRestorationLines(db, orderId)
  const { data, error } = await db.rpc('cancel_order_restock', {
    p_order_id: orderId,
    p_expected_status: order.status,
    p_lines: lines,
  })
  if (error) {
    console.error(`[cancel-order] error orderId=${orderId}`, error)
    throw new OrderError('Error al cancelar orden', 'failed')
  }
  if (data !== true) throw new OrderError(CONFLICT_MESSAGE, 'conflict')
  return { restored: lines.length }
}

/** Deletes the order (items, cut plan and decisions by CASCADE) and, while in store, returns its stock atomically. */
export async function deleteOrder(db: SupabaseClient, orderId: string): Promise<void> {
  const order = await loadOrder(db, orderId)
  // Restoring a cancelled order again would duplicate its stock (ADR-010).
  const lines = deleteRestoresStock(order.status) ? await loadRestorationLines(db, orderId) : []
  const { data, error } = await db.rpc('delete_order_restock', {
    p_order_id: orderId,
    p_expected_status: order.status,
    p_lines: lines,
  })
  if (error) {
    console.error(`[delete-order] error orderId=${orderId}`, error)
    throw new OrderError('Error al eliminar la orden', 'failed')
  }
  if (data !== true) throw new OrderError(CONFLICT_MESSAGE, 'conflict')
}

// ─── Lines ──────────────────────────────────────────────────────────────────

/** Adds a line: reserves its stock first and gives it back if the insert fails (#157). */
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
  const modelCode = text(raw.model_code)

  const { data: maxSort } = await db
    .from('order_items')
    .select('sort_order')
    .eq('order_id', orderId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()
  const sortOrder = ((maxSort as { sort_order?: number } | null)?.sort_order ?? -1) + 1

  const line = { model_code: modelCode, quantity }
  let reservations: Map<string, Reservation>
  try {
    reservations = await reserveInventory(db, stockDemand([line]))
  } catch (error) {
    console.error(`[add-order-item] reserve error orderId=${orderId}`, error)
    throw new OrderError('Error al apartar el inventario', 'failed')
  }
  const [allocation] = allocateLines([line], poolOf(reservations))

  const payload: OrderItemPayload = {
    sort_order: sortOrder,
    item_type: 'product',
    section_label: null,
    etm: text(raw.etm),
    model_code: modelCode,
    description: text(raw.description),
    brand: text(raw.brand),
    quantity_approved: quantity,
    quantity_in_stock: allocation.inStock,
    quantity_to_order: allocation.toOrder,
    quantity_received: 0,
    urrea_status: 'pending',
    delivery_time: 'immediate',
    unit_price: unitPrice,
  }
  const { data: newItem, error } = await db
    .from('order_items')
    .insert({ ...payload, order_id: orderId })
    .select()
    .single()
  if (error) {
    console.error(`[add-order-item] insert error orderId=${orderId}`, error)
    await giveBack(db, reservations, 'add-order-item')
    throw pgOrderError(error, [payload], 'Error al agregar el producto')
  }

  return { item: newItem, total_amount: await recalculateOrderTotal(db, orderId) }
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
  const { order, item } = await loadOrderItem(db, orderId, itemId)
  if (!goodsInStore(order.status)) throw new OrderError(DELIVERED_REMOVE_MESSAGE)

  // Only what the line took from stock goes back, as before #157.
  const key = stockKey(item.model_code)
  const lines: StockLine[] = key && item.quantity_in_stock > 0 ? [{ model_code: key, quantity: item.quantity_in_stock }] : []
  const { data, error } = await db.rpc('remove_order_item_restock', {
    p_order_id: orderId,
    p_item_id: itemId,
    p_expected_status: order.status,
    p_lines: lines,
  })
  if (error) {
    console.error(`[remove-order-item] error itemId=${itemId}`, error)
    throw new OrderError('Error al quitar el producto', 'failed')
  }
  if (data !== true) throw new OrderError(CONFLICT_MESSAGE, 'conflict')

  return { total_amount: await recalculateOrderTotal(db, orderId) }
}

// ─── Reception ──────────────────────────────────────────────────────────────

const URREA_STATUSES: readonly UrreaStatus[] = ['pending', 'supplied', 'not_supplied']

type PersistedReceptionItem = Pick<OrderItem, 'id' | 'model_code' | 'etm' | 'item_type' | 'quantity_received' | 'quantity_to_order'>

/** URREA reception (ADR-019): only the EXCESS enters inventory, as a DELTA — re-confirming is idempotent.
 *  Everything is validated before the first write: lines of another order or without a URREA order are rejected (#157). */
export async function confirmReception(
  db: SupabaseClient,
  orderId: string,
  input: ConfirmReceptionInput,
): Promise<ConfirmReceptionResult> {
  const items = input?.items
  if (!Array.isArray(items) || items.length === 0) throw new OrderError('Items requeridos')
  for (const item of items) {
    if (!Number.isInteger(item.quantity_received) || item.quantity_received < 0) {
      throw new OrderError('La cantidad recibida debe ser un entero mayor o igual a 0')
    }
    if (!URREA_STATUSES.includes(item.urrea_status)) throw new OrderError('Estado de envío inválido')
  }
  const ids = items.map((item) => item.id)
  if (new Set(ids).size !== ids.length) throw new OrderError('Un producto viene repetido en la recepción')

  const order = await loadOrder(db, orderId)
  if (isOrderClosed(order.status)) throw new OrderError(CLOSED_MESSAGE)

  const notInOrder = 'Uno de los productos de la recepción no pertenece a esta orden'
  const { data: rows, error: readError } = await db
    .from('order_items')
    .select('id, model_code, etm, item_type, quantity_received, quantity_to_order')
    .eq('order_id', orderId)
    .in('id', ids)
  if (readError) {
    // A malformed id is a bad request, not a server failure.
    if (readError.code === '22P02') throw new OrderError(notInOrder)
    console.error(`[confirm-reception] items read error orderId=${orderId}`, readError)
    throw new OrderError('Error al leer los productos de la orden', 'failed')
  }
  const persisted = new Map(((rows ?? []) as PersistedReceptionItem[]).map((row) => [row.id, row]))
  for (const item of items) {
    const current = persisted.get(item.id)
    if (!current) throw new OrderError(notInOrder)
    if (current.item_type !== 'separator' && current.quantity_to_order <= 0) {
      const tag = current.model_code || current.etm
      throw new OrderError(`${tag}: no se pidió a URREA (salió completo de stock), así que no lleva recepción`)
    }
  }

  let inventoryUpdated = 0
  const warnings: string[] = []

  for (const item of items) {
    const current = persisted.get(item.id)
    if (!current || current.item_type === 'separator') continue

    // Delta assumes quantity_to_order stays stable across receptions; revisit if it becomes editable (ADR-019).
    const delta =
      receptionExcess({ quantity_received: item.quantity_received, quantity_to_order: current.quantity_to_order }) -
      receptionExcess(current)
    const tag = current.etm || current.model_code || item.id

    // oxlint-disable-next-line react-doctor/async-await-in-loop -- sequential writes: a failure stops the batch
    const { error: updateError } = await db
      .from('order_items')
      .update({ quantity_received: item.quantity_received, urrea_status: item.urrea_status })
      .eq('id', item.id)
      .eq('order_id', orderId)
    if (updateError) {
      throw pgOrderError(updateError, undefined, 'Error al actualizar la recepción')
    }

    const code = stockKey(current.model_code)
    if (delta === 0 || !code) continue

    let adjustment
    try {
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- sequential writes: a failure stops the batch
      adjustment = await adjustInventory(db, code, delta)
    } catch (error) {
      console.error(`[confirm-reception] inventory error model=${code}`, error)
      throw new OrderError('Error al ajustar el inventario', 'failed')
    }
    if (adjustment.missing) {
      warnings.push(`${tag}: no existe fila de inventario de ${code} para restar la corrección del excedente.`)
      continue
    }
    if (adjustment.clamped) {
      warnings.push(
        `${tag}: la corrección dejaría el stock en negativo; se ajustó a 0 (revisa el inventario de ${code}).`,
      )
    }
    inventoryUpdated++
  }

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

  return { success: true, inventory_updated: inventoryUpdated, warnings }
}
