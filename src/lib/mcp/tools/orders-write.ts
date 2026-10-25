/**
 * save_order and save_order_reception (#155 D, ADR-041): the order's life through the assistant. Every stock move goes
 * through orders-store and its atomic DB functions (ADR-042), never around them. The yes comes first for everything
 * that touches stock; only the delivery time of a line and the Odoo id write directly. The summaries show the
 * allocation per line and what returns to inventory, computed with the same rules the store applies.
 */

import type { WritePlan } from '@/lib/mcp/core/define'
import { diff, refOf, versionOf, writeResult, type Changes } from '@/lib/mcp/core/envelope'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import {
  allocateLines,
  calculateDeliveredTotal,
  calculateOrderTotal,
  isProductItem,
  normalizeCatalogCode,
  receptionExcess,
  statusAfterReceived,
} from '@/lib/business-rules'
import { DELIVERY_TIME_TOKENS } from '@/lib/delivery'
import { canChangeOrderStatus, computeRestoration, goodsInStore, isOrderClosed } from '@/lib/inventory'
import {
  addOrderItem,
  cancelOrder,
  confirmReception,
  createManualOrder,
  createOrderFromQuotation,
  removeOrderItem,
  setOrderStatus,
  updateOrderItem,
  updateOrderOdooId,
} from '@/lib/orders-store'
import { ORDER_STATUS_TOKENS, URREA_STATUS_TOKENS } from '@/lib/order-status'
import { fold } from '@/lib/text'
import type { DeliveryTime, Order, OrderItem, OrderStatus, QuotationItem, UrreaStatus } from '@/types/database'
import { findOrderByQuotation, resolveOrder } from './orders'
import { resolveQuotation } from './quotations'
import { loadQuotation } from './quotations-write'

// ── input ────────────────────────────────────────────────────────────────────

export interface OrderProductInput {
  etm: string
  descripcion?: string
  codigo?: string
  marca?: string
  cantidad: number
  precio: number
}

export interface OrderChangeInput {
  linea: number
  /** Guard: the ETM the caller expects on that line. */
  etm?: string
  precio?: number
  entrega?: string
  quitar?: true
}

export interface SaveOrderInput {
  orden?: string
  cotizacion?: string
  cliente?: string
  productos?: OrderProductInput[]
  estado?: string
  odoo_id?: string | null
  cambios?: OrderChangeInput[]
}

// ── reading ──────────────────────────────────────────────────────────────────

type FullOrder = Order & { order_items: OrderItem[] }

async function loadOrderFull(db: Db, id: string): Promise<FullOrder> {
  const { data, error } = await db
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', id)
    .order('sort_order', { foreignTable: 'order_items', ascending: true })
    .limit(5000, { foreignTable: 'order_items' })
    .single()
  if (error || !data) throw new ToolError(error?.code === 'PGRST116' ? 'Orden no encontrada' : `Error al leer la orden: ${error?.message ?? 'sin datos'}`)
  return data as FullOrder
}

/** Available stock per code, as the reservation will see it. */
async function stockOf(db: Db, codes: readonly string[]): Promise<Map<string, number>> {
  const wanted = [...new Set(codes.filter((code) => code.trim() !== ''))]
  const pool = new Map<string, number>()
  if (wanted.length === 0) return pool
  const { data, error } = await db.from('store_inventory').select('model_code, quantity').in('model_code', wanted)
  if (error) throw new ToolError(`Error al leer el inventario: ${error.message}`)
  for (const row of (data ?? []) as { model_code: string; quantity: number }[]) pool.set(row.model_code, row.quantity)
  return pool
}

const money = (n: number) => Math.round(n * 100) / 100
const lineKey = (item: Pick<OrderItem, 'id' | 'quantity_in_stock' | 'quantity_to_order' | 'quantity_received' | 'unit_price' | 'delivery_time' | 'urrea_status'>) =>
  [item.id, item.quantity_in_stock, item.quantity_to_order, item.quantity_received, item.unit_price, item.delivery_time, item.urrea_status]

const deliveryOf = (token: string): DeliveryTime => {
  const value = DELIVERY_TIME_TOKENS.toDb(token)
  if (!value) throw new ToolError(`Entrega inválida "${token}": usa ${DELIVERY_TIME_TOKENS.tokens.join(' | ')}`)
  return value
}

const orderEntity = (order: Pick<Order, 'id' | 'name' | 'customer_name' | 'status'>, total: number, extra: object = {}) => ({
  ref: refOf(order.id),
  nombre: order.name,
  cliente: order.customer_name,
  estado: ORDER_STATUS_TOKENS.toToken(order.status),
  total: money(total),
  ...extra,
})

/** What a new order would do per line: the stock it would take and what goes to URREA, with one running pool per code. */
function allocationRows(lines: readonly { etm: string; code: string; quantity: number; price: number }[], pool: ReadonlyMap<string, number>) {
  const split = allocateLines(lines.map((l) => ({ model_code: l.code, quantity: l.quantity })), pool)
  return lines.map((l, i) => ({
    etm: l.etm,
    codigo: l.code,
    cantidad: l.quantity,
    en_stock: split[i].inStock,
    por_pedir: split[i].toOrder,
    precio: l.price,
    importe: money(l.price * l.quantity),
  }))
}

function stockAvisos(rows: readonly { en_stock: number; por_pedir: number }[], what: string): string[] {
  const taken = rows.reduce((sum, r) => sum + r.en_stock, 0)
  const toOrder = rows.filter((r) => r.por_pedir > 0).length
  return [
    taken > 0 ? `${what} descuenta ${taken} piezas del inventario de la tienda.` : `${what} no toma nada del inventario.`,
    ...(toOrder > 0 ? [`${toOrder} línea${toOrder === 1 ? '' : 's'} quedan por pedir a URREA.`] : []),
  ]
}

// ── plan ─────────────────────────────────────────────────────────────────────

type Carry =
  | { kind: 'from_quotation'; quotationId: string }
  | { kind: 'manual'; customer: string; products: OrderProductInput[] }
  | { kind: 'status'; orderId: string; to: OrderStatus }
  | { kind: 'odoo'; orderId: string; value: string | null }
  | { kind: 'lines'; orderId: string; edits: { id: string; body: { unit_price?: number; delivery_time?: DeliveryTime } }[]; removals: string[]; additions: OrderProductInput[] }

export async function planSaveOrder(db: Db, input: SaveOrderInput): Promise<WritePlan<Carry>> {
  const editing = input.estado !== undefined || input.odoo_id !== undefined || input.cambios !== undefined
  if (!input.orden) {
    if (editing) throw new ToolError('Para cambiar una orden indica `orden`; para crear manda `cotizacion` o `cliente` con `productos`.')
    if (input.cotizacion) {
      if (input.cliente !== undefined || input.productos !== undefined) throw new ToolError('Crear desde una cotización no lleva `cliente` ni `productos`; una orden manual no lleva `cotizacion`.')
      return planFromQuotation(db, input.cotizacion)
    }
    return planManual(db, input)
  }
  if (input.cotizacion !== undefined || input.cliente !== undefined) throw new ToolError('`cotizacion` y `cliente` son para crear; con `orden` solo se cambia esa orden.')
  const intentions = [input.estado !== undefined, input.odoo_id !== undefined, input.cambios !== undefined || input.productos !== undefined].filter(Boolean).length
  if (intentions === 0) throw new ToolError('Indica qué hacer: `estado`, `odoo_id`, `cambios` o `productos` para agregar.')
  if (intentions > 1) throw new ToolError('Una intención por llamada: estado, Odoo id y cambios de líneas van en llamadas separadas, cada una con su resumen.')
  const order = await resolveOrder(db, input.orden)
  if (input.estado !== undefined) return planStatus(db, order.id, input.estado)
  if (input.odoo_id !== undefined) return planOdoo(db, order.id, input.odoo_id)
  return planLines(db, order.id, input)
}

async function planFromQuotation(db: Db, reference: string): Promise<WritePlan<Carry>> {
  const ref = await resolveQuotation(db, reference)
  const quotation = await loadQuotation(db, ref.id)
  const bloqueos: string[] = []
  if (quotation.status !== 'approved') bloqueos.push(`La cotización «${quotation.name}» está ${quotation.status === 'converted_to_order' ? 'convertida' : 'en otro estado'}: solo una aprobada genera orden.`)
  const existing = await findOrderByQuotation(db, quotation.id)
  if (existing) bloqueos.push(`Ya tiene la orden ${existing.name}.`)

  const items = quotation.quotation_items.slice().sort((a: QuotationItem, b: QuotationItem) => a.sort_order - b.sort_order)
  const products = items.filter((i) => isProductItem(i) && i.is_approved === true && i.is_sold !== false)
  if (products.length === 0) bloqueos.push('No hay productos aprobados en esta cotización.')
  const lines = products.map((i) => ({ etm: i.etm ?? '', code: i.model_code ?? '', quantity: i.quantity ?? 1, price: i.unit_price ?? 0 }))
  const pool = await stockOf(db, lines.map((l) => l.code))
  const rows = allocationRows(lines, pool)
  const total = calculateOrderTotal(lines.map((l) => ({ unit_price: l.price, quantity_approved: l.quantity, item_type: 'product' })))
  return {
    entity: { key: 'orden', value: { cotizacion: quotation.name, cliente: quotation.customer_name, total: money(total), lineas: rows } },
    avisos: [...stockAvisos(rows, 'Crear la orden'), 'La cotización pasa a convertida y deja de ser editable; para reabrirla hay que eliminar la orden.'],
    bloqueos: bloqueos.length > 0 ? bloqueos : undefined,
    fingerprint: { q: quotation.id, status: quotation.status, updated: quotation.updated_at, stock: [...pool], orden: existing?.id ?? null },
    subject: `La cotización «${quotation.name}»`,
    carry: { kind: 'from_quotation', quotationId: quotation.id },
  }
}

async function planManual(db: Db, input: SaveOrderInput): Promise<WritePlan<Carry>> {
  const customer = input.cliente?.trim() ?? ''
  if (!customer || !input.productos?.length) throw new ToolError('Para crear una orden manual indica `cliente` y `productos`; o `cotizacion` para crearla desde una aprobada.')
  const products = input.productos.map((p, i) => {
    if (!p.etm?.trim()) throw new ToolError(`Producto ${i + 1}: indica el ETM.`)
    return { ...p, etm: p.etm.trim(), codigo: p.codigo?.trim() ?? '' }
  })
  const lines = products.map((p) => ({ etm: p.etm, code: p.codigo, quantity: p.cantidad, price: p.precio }))
  const pool = await stockOf(db, lines.map((l) => l.code))
  const rows = allocationRows(lines, pool)
  const { count, error } = await db.from('orders').select('id', { count: 'exact', head: true }).eq('customer_name', customer)
  if (error) throw new ToolError(`Error al revisar las órdenes: ${error.message}`)
  const total = calculateOrderTotal(lines.map((l) => ({ unit_price: l.price, quantity_approved: l.quantity, item_type: 'product' })))
  return {
    entity: { key: 'orden', value: { cliente: customer, total: money(total), lineas: rows } },
    avisos: [...stockAvisos(rows, 'Crear la orden'), 'Es una orden manual: no tiene cotización detrás.', ...((count ?? 0) > 0 ? [`${customer} ya tiene ${count} órdenes: esta sería otra.`] : [])],
    // Creating is not idempotent: another order for this customer moves the count, so a repeated key meets another fingerprint.
    fingerprint: { cliente: customer, ordenes: count ?? 0, stock: [...pool], lineas: lines.map((l) => [l.etm, l.code, l.quantity, l.price]) },
    subject: `La orden de ${customer}`,
    carry: { kind: 'manual', customer, products },
  }
}

async function planStatus(db: Db, orderId: string, token: string): Promise<WritePlan<Carry>> {
  const to = ORDER_STATUS_TOKENS.toDb(token)
  if (!to) throw new ToolError(`Estado inválido "${token}": usa ${ORDER_STATUS_TOKENS.tokens.join(' | ')}`)
  const order = await loadOrderFull(db, orderId)
  const total = calculateOrderTotal(order.order_items)
  const base = {
    entity: { key: 'orden', value: orderEntity(order, total) },
    subject: `La orden ${order.name}`,
    fingerprint: { id: order.id, status: order.status, lines: order.order_items.map(lineKey) },
    carry: { kind: 'status' as const, orderId, to },
  }
  if (order.status === to) return { ...base, avisos: [`La orden ya está ${token}.`], sinCambios: true }

  const bloqueos: string[] = []
  const avisos: string[] = []
  if (order.status === 'cancelled') bloqueos.push('Una orden cancelada ya no cambia de estado.')
  else if (to === 'cancelled') {
    if (order.status === 'completed') bloqueos.push('No se puede cancelar una orden completada.')
    else if (!goodsInStore(order.status)) bloqueos.push('No se puede cancelar una orden entregada: el material ya salió con el cliente. Si hubo devolución, ajusta el inventario a mano.')
    else {
      const back = new Map<string, number>()
      for (const r of computeRestoration(order.order_items.filter(isProductItem))) back.set(r.model_code, (back.get(r.model_code) ?? 0) + r.quantityToRestore)
      avisos.push(
        back.size > 0
          ? `Devuelve al inventario: ${[...back].map(([code, qty]) => `${code} ×${qty}`).join(', ')} (lo tomado de stock más lo recibido para el cliente; el excedente ya entró).`
          : 'No hay nada que devolver al inventario.',
        'Cancelar no se deshace y la cotización ligada no cambia.',
      )
    }
  } else if (!canChangeOrderStatus(order.status, to)) {
    bloqueos.push('La orden ya se entregó: no puede regresar a pedida ni a recibida.')
  } else {
    if (to === 'completed') avisos.push('Completada bloquea editar líneas, recibir y decidir compras.')
    if (to === 'delivered') avisos.push('Una entregada ya no regresa a pedida ni a recibida, ni se cancela.')
  }
  return {
    ...base,
    cambios: { estado: { antes: ORDER_STATUS_TOKENS.toToken(order.status), ahora: token } },
    avisos,
    bloqueos: bloqueos.length > 0 ? bloqueos : undefined,
  }
}

async function planOdoo(db: Db, orderId: string, raw: string | null): Promise<WritePlan<Carry>> {
  const order = await loadOrderFull(db, orderId)
  const value = typeof raw === 'string' ? raw.trim() || null : null
  return {
    entity: { key: 'orden', value: orderEntity(order, calculateOrderTotal(order.order_items), { odoo_id: value }) },
    cambios: { odoo_id: { antes: order.odoo_id ?? null, ahora: value } },
    sinCambios: (order.odoo_id ?? null) === value,
    // Metadata with no stock behind it: low risk, it writes at once.
    directo: true,
    fingerprint: { id: order.id, odoo_id: order.odoo_id ?? null },
    subject: `La orden ${order.name}`,
    carry: { kind: 'odoo', orderId, value },
  }
}

async function planLines(db: Db, orderId: string, input: SaveOrderInput): Promise<WritePlan<Carry>> {
  const order = await loadOrderFull(db, orderId)
  if (isOrderClosed(order.status)) throw new ToolError('Una orden completada o cancelada no se modifica.')
  const items = order.order_items
  const changes = input.cambios ?? []
  const additions = (input.productos ?? []).map((p, i) => {
    if (!p.etm?.trim()) throw new ToolError(`Producto ${i + 1}: indica el ETM.`)
    return { ...p, etm: p.etm.trim(), codigo: p.codigo?.trim() ?? '' }
  })

  const seen = new Set<number>()
  const edits: { id: string; body: { unit_price?: number; delivery_time?: DeliveryTime } }[] = []
  const removals: string[] = []
  const cambios: Record<string, { antes: unknown; ahora: unknown }> = {}
  const avisos: string[] = []
  let returned = 0
  const after = items.map((i) => ({ ...i }))
  const removedAt = new Set<number>()

  for (const [index, change] of changes.entries()) {
    const where = `cambios[${index + 1}]`
    const item = items[change.linea - 1]
    if (!item) throw new ToolError(`${where}: no hay línea ${change.linea}: la orden tiene ${items.length}.`)
    if (seen.has(change.linea)) throw new ToolError(`${where}: la línea ${change.linea} viene dos veces.`)
    seen.add(change.linea)
    if (change.etm !== undefined && (!isProductItem(item) || fold(item.etm) !== fold(change.etm))) {
      throw new ToolError(`La línea ${change.linea} es ${isProductItem(item) ? `el ETM ${item.etm}` : 'una sección'}, no ${change.etm}: vuelve a leer la orden.`)
    }
    const label = `linea ${change.linea} (${isProductItem(item) ? `ETM ${item.etm}` : 'sección'})`
    if (change.quitar) {
      if (change.precio !== undefined || change.entrega !== undefined) throw new ToolError(`${where}: una operación por elemento (editar o quitar).`)
      if (!goodsInStore(order.status)) throw new ToolError('No se puede quitar un producto de una orden entregada: ya salió con el cliente. Si hubo devolución, ajusta el inventario a mano.')
      removals.push(item.id)
      removedAt.add(change.linea - 1)
      returned += isProductItem(item) ? item.quantity_in_stock : 0
      cambios[label] = { antes: 'estaba', ahora: 'se quita' }
      continue
    }
    if (change.precio === undefined && change.entrega === undefined) throw new ToolError(`${where}: indica qué cambiar (precio, entrega) o quitar.`)
    if (!isProductItem(item)) throw new ToolError(`${where}: la línea ${change.linea} es una sección.`)
    const body: { unit_price?: number; delivery_time?: DeliveryTime } = {}
    const was: Record<string, unknown> = {}
    const will: Record<string, unknown> = {}
    if (change.precio !== undefined) {
      body.unit_price = change.precio
      was.precio = item.unit_price
      will.precio = change.precio
      after[change.linea - 1].unit_price = change.precio
    }
    if (change.entrega !== undefined) {
      body.delivery_time = deliveryOf(change.entrega)
      was.entrega = DELIVERY_TIME_TOKENS.toToken(item.delivery_time)
      will.entrega = change.entrega
    }
    edits.push({ id: item.id, body })
    cambios[label] = { antes: was, ahora: will }
  }

  if (additions.length > 0 && !goodsInStore(order.status)) throw new ToolError('No se pueden agregar productos a una orden entregada: el material ya salió con el cliente.')
  // Added lines draw from the stock as it will be after the removals gave theirs back.
  const pool = await stockOf(db, additions.map((p) => p.codigo))
  for (const id of removals) {
    const item = items.find((i) => i.id === id)
    if (item && isProductItem(item) && pool.has(item.model_code)) pool.set(item.model_code, (pool.get(item.model_code) ?? 0) + item.quantity_in_stock)
  }
  const added = allocationRows(additions.map((p) => ({ etm: p.etm, code: p.codigo, quantity: p.cantidad, price: p.precio })), pool)
  added.forEach((row, i) => {
    cambios[`linea nueva ${i + 1}`] = { antes: null, ahora: `ETM ${row.etm} × ${row.cantidad} a $${row.precio} (en stock ${row.en_stock}, por pedir ${row.por_pedir})` }
  })

  const kept = after.filter((_, i) => !removedAt.has(i))
  const totalBefore = calculateOrderTotal(items)
  const totalAfter = calculateOrderTotal([...kept, ...additions.map((p) => ({ item_type: 'product' as const, unit_price: p.precio, quantity_approved: p.cantidad }))])
  if (totalBefore !== totalAfter) cambios.total = { antes: money(totalBefore), ahora: money(totalAfter) }
  if (returned > 0) avisos.push(`Quitar devuelve ${returned} piezas al inventario (lo que esas líneas tomaron de stock).`)
  if (added.length > 0) avisos.push(...stockAvisos(added, 'Agregar'))
  if (order.status === 'delivered' && Object.keys(cambios).length > 0) avisos.push('Está entregada: el precio y la entrega se corrigen, pero no se mueve stock.')

  const onlyDelivery = additions.length === 0 && removals.length === 0 && edits.every((e) => e.body.unit_price === undefined)
  return {
    entity: { key: 'orden', value: orderEntity(order, totalAfter, { version: versionOf(order.updated_at, items.map((i) => i.id)) }) },
    cambios: cambios as Changes,
    avisos,
    sinCambios: Object.keys(cambios).length === 0,
    // The delivery time moves no stock and no money: it writes at once. Price, adding and removing ask for the yes.
    directo: onlyDelivery,
    fingerprint: { id: order.id, status: order.status, lines: items.map(lineKey), stock: [...pool] },
    subject: `La orden ${order.name}`,
    carry: { kind: 'lines', orderId, edits, removals, additions },
  }
}

// ── commit ───────────────────────────────────────────────────────────────────

export async function commitSaveOrder(db: Db, userId: string, plan: WritePlan<Carry>) {
  const { carry } = plan
  if (carry.kind === 'from_quotation') {
    const created = await createOrderFromQuotation(db, carry.quotationId, userId)
    return writeResult('creado', 'orden', { ...(plan.entity.value as object), ref: refOf(created.order_id), lineas: created.items_count }, { avisos: plan.avisos })
  }
  if (carry.kind === 'manual') {
    const created = await createManualOrder(
      db,
      {
        customer_name: carry.customer,
        products: carry.products.map((p) => ({ etm: p.etm, description: p.descripcion ?? '', description_es: p.descripcion ?? '', model_code: p.codigo ?? '', quantity: p.cantidad, price: p.precio, brand: p.marca ?? '' })),
      },
      userId,
    )
    return writeResult('creado', 'orden', { ...(plan.entity.value as object), ref: refOf(created.order_id), lineas: created.items_count }, { avisos: plan.avisos })
  }
  if (carry.kind === 'status') {
    if (carry.to === 'cancelled') await cancelOrder(db, carry.orderId)
    else await setOrderStatus(db, carry.orderId, { status: carry.to })
    return writeResult('actualizado', 'orden', { ...(plan.entity.value as object), estado: ORDER_STATUS_TOKENS.toToken(carry.to) }, { cambios: plan.cambios, avisos: plan.avisos })
  }
  if (carry.kind === 'odoo') {
    await updateOrderOdooId(db, carry.orderId, { odoo_id: carry.value })
    return writeResult('actualizado', 'orden', plan.entity.value, { cambios: plan.cambios })
  }

  // Lines: edits, then removals (they give stock back), then additions (they take it), each atomic on its own.
  const done: string[] = []
  const stop = (what: string, error: unknown) =>
    new ToolError(`${done.length ? `Ya quedó hecho: ${done.join(', ')}. ` : ''}Falló ${what}: ${error instanceof Error ? error.message : 'error'}. Vuelve a pedir el resumen antes de seguir.`)
  try {
    for (const edit of carry.edits) {
      await updateOrderItem(db, carry.orderId, edit.id, edit.body)
      done.push('un cambio de línea')
    }
    for (const id of carry.removals) {
      await removeOrderItem(db, carry.orderId, id)
      done.push('una línea quitada')
    }
    for (const p of carry.additions) {
      await addOrderItem(db, carry.orderId, { etm: p.etm, description: p.descripcion ?? '', model_code: p.codigo ?? '', brand: p.marca ?? '', unit_price: p.precio, quantity_approved: p.cantidad })
      done.push(`${p.etm} agregado`)
    }
  } catch (error) {
    throw stop(`el paso ${done.length + 1}`, error)
  }
  const fresh = await loadOrderFull(db, carry.orderId)
  return writeResult('actualizado', 'orden', orderEntity(fresh, calculateOrderTotal(fresh.order_items), { version: versionOf(fresh.updated_at, fresh.order_items.map((i) => i.id)) }), {
    cambios: plan.cambios,
    avisos: plan.avisos,
  })
}

// ── save_order_reception ─────────────────────────────────────────────────────

export interface ReceptionLineInput {
  codigo?: string
  linea?: number
  recibido: number
  estado?: string
}

export interface SaveOrderReceptionInput {
  orden: string
  lineas: ReceptionLineInput[]
}

type ReceptionCarry = { orderId: string; items: { id: string; quantity_received: number; urrea_status: UrreaStatus }[] }

export async function planSaveOrderReception(db: Db, input: SaveOrderReceptionInput): Promise<WritePlan<ReceptionCarry>> {
  const ref = await resolveOrder(db, input.orden)
  const order = await loadOrderFull(db, ref.id)
  if (isOrderClosed(order.status)) throw new ToolError('Una orden completada o cancelada no recibe.')
  const items = order.order_items

  const seen = new Set<string>()
  const avisos: string[] = []
  const lineas: unknown[] = []
  const payload: ReceptionCarry['items'] = []
  const next = new Map<string, { received: number; status: UrreaStatus }>()
  let stockDelta = 0

  for (const [index, line] of input.lineas.entries()) {
    const where = `lineas[${index + 1}]`
    let item: OrderItem | undefined
    if (line.linea !== undefined) {
      item = items[line.linea - 1]
      if (!item) throw new ToolError(`${where}: no hay línea ${line.linea}: la orden tiene ${items.length}.`)
    } else if (line.codigo) {
      const code = normalizeCatalogCode(line.codigo)
      const matches = items.filter((i) => isProductItem(i) && normalizeCatalogCode(i.model_code) === code)
      if (matches.length === 0) throw new ToolError(`${where}: la orden no trae el código ${code}.`)
      if (matches.length > 1) throw new ToolError(`${where}: el código ${code} está en ${matches.length} líneas (${matches.map((m) => items.indexOf(m) + 1).join(', ')}): indica \`linea\`.`)
      item = matches[0]
    } else {
      throw new ToolError(`${where}: indica el \`codigo\` o la \`linea\`.`)
    }
    if (!isProductItem(item)) throw new ToolError(`${where}: esa línea es una sección.`)
    if (item.quantity_to_order <= 0) throw new ToolError(`${where}: ${item.etm} no se pidió a URREA (salió completo de stock): no lleva recepción.`)
    if (seen.has(item.id)) throw new ToolError(`${where}: esa línea viene dos veces.`)
    seen.add(item.id)

    let status: UrreaStatus
    if (line.estado !== undefined) {
      const picked = URREA_STATUS_TOKENS.toDb(line.estado)
      if (!picked) throw new ToolError(`${where}: estado inválido "${line.estado}": usa ${URREA_STATUS_TOKENS.tokens.join(' | ')}`)
      status = picked
    } else {
      // Reaching what was ordered marks it supplied (#146); a partial reception leaves the state as it is.
      status = statusAfterReceived(line.recibido, item.quantity_to_order, { status: item.urrea_status, autoFrom: null, manual: false }).status
    }

    const delta = receptionExcess({ quantity_received: line.recibido, quantity_to_order: item.quantity_to_order }) - receptionExcess(item)
    stockDelta += delta
    next.set(item.id, { received: line.recibido, status })
    payload.push({ id: item.id, quantity_received: line.recibido, urrea_status: status })
    lineas.push({
      linea: items.indexOf(item) + 1,
      etm: item.etm,
      codigo: item.model_code,
      pedido: item.quantity_to_order,
      recibido: { antes: item.quantity_received, ahora: line.recibido },
      estado: URREA_STATUS_TOKENS.toToken(status),
      a_tienda: delta,
    })
    if (line.recibido > item.quantity_to_order * 2) avisos.push(`⚠️ ${item.etm}: recibiste ${line.recibido}, más del doble de lo pedido (${item.quantity_to_order}). Revisa el número.`)
    if (delta > 0) avisos.push(`${item.etm}: ${delta} piezas de excedente entran al inventario de la tienda.`)
    if (delta < 0) avisos.push(`${item.etm}: corrige a la baja el excedente; se restan ${-delta} piezas del inventario (sin bajar de 0).`)
  }

  const nextItems = items.map((i) => (next.has(i.id) ? { ...i, quantity_received: next.get(i.id)!.received, urrea_status: next.get(i.id)!.status } : i))
  const totalBefore = calculateDeliveredTotal(items)
  const totalAfter = calculateDeliveredTotal(nextItems)
  const cambios: Record<string, { antes: unknown; ahora: unknown }> = {}
  if (totalBefore !== totalAfter) cambios.total_entrega = { antes: money(totalBefore), ahora: money(totalAfter) }
  if (stockDelta !== 0) cambios.inventario_tienda = { antes: null, ahora: `${stockDelta > 0 ? '+' : ''}${stockDelta} piezas` }
  const unchanged = payload.every((p) => {
    const item = items.find((i) => i.id === p.id)!
    return item.quantity_received === p.quantity_received && item.urrea_status === p.urrea_status
  })
  return {
    entity: { key: 'recepcion', value: { orden: orderEntity(order, calculateOrderTotal(items)), lineas, total_entrega: { antes: money(totalBefore), ahora: money(totalAfter) } } },
    cambios: cambios as Changes,
    avisos,
    sinCambios: unchanged,
    // Re-confirming is idempotent by design (ADR-019), and the lines move with the write: a repeated key finds them equal.
    fingerprint: { id: order.id, status: order.status, lines: items.map(lineKey) },
    subject: `La orden ${order.name}`,
    carry: { orderId: order.id, items: payload },
  }
}

export async function commitSaveOrderReception(db: Db, plan: WritePlan<ReceptionCarry>) {
  const result = await confirmReception(db, plan.carry.orderId, { items: plan.carry.items })
  return writeResult('actualizado', 'recepcion', plan.entity.value, { cambios: plan.cambios, avisos: [...(plan.avisos ?? []), ...result.warnings] })
}

export { diff }
