/**
 * In-memory stand-ins for the atomic stock functions of #157, same semantics as the SQL, so route tests
 * assert the resulting stock and order instead of payloads. They reuse the JS rules the SQL mirrors
 * (computeRestoration, receptionExcess); the real functions run in tests/integration/orders.integration.test.ts.
 */

import { receptionExcess } from '@/lib/business-rules'
import { computeRestoration } from '@/lib/inventory'
import type { CallRecord, MockResult } from './supabase-mock'

type Row = { quantity: number; location: string | null }
type Line = { model_code: string; quantity: number }

function consolidate(lines: Line[] | undefined): Array<[string, number]> {
  const byCode = new Map<string, number>()
  for (const line of lines ?? []) {
    if (!line.model_code?.trim()) continue
    byCode.set(line.model_code, (byCode.get(line.model_code) ?? 0) + line.quantity)
  }
  return [...byCode].sort(([a], [b]) => a.localeCompare(b))
}

const params = (rec: CallRecord) => (rec.payload ?? {}) as Record<string, unknown>

export function stockRpc(initial: Record<string, number | Row> = {}) {
  const stock = new Map<string, Row>()
  for (const [code, value] of Object.entries(initial)) {
    stock.set(code, typeof value === 'number' ? { quantity: value, location: null } : { ...value })
  }

  /** release_inventory: adds back, creating missing rows; returns codes touched. */
  const release = (lines: Line[] | undefined): number => {
    let touched = 0
    for (const [code, quantity] of consolidate(lines)) {
      if (quantity <= 0) continue
      const row = stock.get(code)
      if (row) row.quantity += quantity
      else stock.set(code, { quantity, location: null })
      touched++
    }
    return touched
  }

  /** adjust_inventory: positive adds (creating the row), negative clamps at 0. */
  const adjust = (code: string, delta: number): { clamped: boolean; missing: boolean } => {
    const row = stock.get(code)
    if (delta > 0) {
      if (row) row.quantity += delta
      else stock.set(code, { quantity: delta, location: null })
      return { clamped: false, missing: false }
    }
    if (!row) return { clamped: false, missing: true }
    const target = row.quantity + delta
    row.quantity = Math.max(0, target)
    return { clamped: target < 0, missing: false }
  }

  /** reserve_inventory for one code: takes what there is, up to what was asked; no row reserves nothing. */
  const reserve = (code: string, asked: number): { reserved: number; location: string | null } => {
    const row = stock.get(code)
    if (!row || asked <= 0) return { reserved: 0, location: null }
    const reserved = Math.min(Math.max(row.quantity, 0), asked)
    row.quantity -= reserved
    return { reserved, location: row.location }
  }

  const responses: Record<string, (rec: CallRecord) => MockResult> = {
    'rpc.reserve_inventory': (rec) => {
      const result = consolidate(params(rec).p_lines as Line[]).flatMap(([code, asked]) =>
        asked <= 0 ? [] : [{ model_code: code, ...reserve(code, asked) }],
      )
      return { data: result, error: null }
    },
    'rpc.release_inventory': (rec) => ({ data: release(params(rec).p_lines as Line[]), error: null }),
  }

  return {
    stock,
    responses,
    release,
    reserve,
    adjust,
    /** Current quantity of a code; undefined = no row. */
    quantity: (code: string) => stock.get(code)?.quantity,
  }
}

export interface MockOrderLine {
  id: string
  model_code: string
  etm?: string
  item_type?: 'product' | 'separator'
  quantity_in_stock: number
  quantity_received: number
  quantity_to_order: number
  urrea_status?: string
  sort_order?: number
  unit_price?: number
}

export interface MockOrder {
  id: string
  /** 'deleted' once delete_order_restock ran. */
  status: string
  items: MockOrderLine[]
}

const raise = (message: string, details?: string): MockResult => ({
  data: null,
  error: { code: 'P0001', message, details: details ?? null },
})

/** The order-level functions (cancel/delete/remove/receive) over one in-memory order and its stock. */
export function orderRpc(stock: ReturnType<typeof stockRpc>, order: MockOrder) {
  const guard = (rec: CallRecord) =>
    params(rec).p_order_id === order.id && params(rec).p_expected_status === order.status
  const restockLines = () =>
    computeRestoration(order.items.filter((i) => i.item_type !== 'separator'))
      .map(({ model_code, quantityToRestore }) => ({ model_code, quantity: quantityToRestore }))

  const responses: Record<string, (rec: CallRecord) => MockResult> = {
    'rpc.cancel_order_restock': (rec) => {
      if (!guard(rec) || order.status === 'cancelled') return { data: null, error: null }
      order.status = 'cancelled'
      return { data: stock.release(restockLines()), error: null }
    },
    'rpc.delete_order_restock': (rec) => {
      if (!guard(rec)) return { data: null, error: null }
      const lines = params(rec).p_restock === true ? restockLines() : []
      order.status = 'deleted'
      order.items = []
      return { data: stock.release(lines), error: null }
    },
    'rpc.remove_order_item_restock': (rec) => {
      if (!guard(rec)) return { data: null, error: null }
      const line = order.items.find((i) => i.id === params(rec).p_item_id)
      if (!line) return { data: null, error: null }
      order.items = order.items.filter((i) => i !== line)
      return { data: stock.release([{ model_code: line.model_code, quantity: line.quantity_in_stock }]), error: null }
    },
    'rpc.add_order_item': (rec) => {
      if (params(rec).p_order_id !== order.id || order.status === 'deleted') return raise('order_not_found')
      if (order.status === 'completed' || order.status === 'cancelled') return raise('order_closed')
      if (order.status !== 'ordered' && order.status !== 'received') return raise('order_delivered')
      const item = params(rec).p_item as {
        etm: string; description: string; model_code: string; brand: string; unit_price: number; quantity_approved: number
      }
      const reserved = item.model_code.trim() ? stock.reserve(item.model_code, item.quantity_approved).reserved : 0
      const line: MockOrderLine = {
        id: `new-${order.items.length + 1}`,
        model_code: item.model_code,
        etm: item.etm,
        item_type: 'product',
        quantity_in_stock: reserved,
        quantity_received: 0,
        quantity_to_order: item.quantity_approved - reserved,
        urrea_status: 'pending',
        sort_order: Math.max(-1, ...order.items.map((i) => i.sort_order ?? 0)) + 1,
        unit_price: item.unit_price,
      }
      order.items.push(line)
      return { data: { ...line, order_id: order.id, description: item.description, brand: item.brand, quantity_approved: item.quantity_approved }, error: null }
    },
    'rpc.receive_order_items': (rec) => {
      if (params(rec).p_order_id !== order.id || order.status === 'deleted') return raise('order_not_found')
      if (order.status === 'completed' || order.status === 'cancelled') return raise('order_closed')
      const items = params(rec).p_items as { id: string; quantity_received: number; urrea_status: string }[]
      if (new Set(items.map((i) => i.id)).size !== items.length) return raise('duplicate_item')
      if (items.some((i) => !order.items.some((l) => l.id === i.id))) return raise('item_not_in_order')

      // Validate before writing: the SQL raises and rolls the whole batch back.
      const pairs = items
        .map((input) => ({ input, line: order.items.find((l) => l.id === input.id)! }))
        .filter(({ line }) => line.item_type !== 'separator')
        .sort((a, b) => a.line.model_code.localeCompare(b.line.model_code))
      const unordered = pairs.find(({ line }) => line.quantity_to_order <= 0)
      if (unordered) return raise('item_not_ordered', unordered.line.etm || unordered.line.model_code)

      let updated = 0
      const warnings: { tag: string; model_code: string; kind: string }[] = []
      for (const { input, line } of pairs) {
        const delta =
          receptionExcess({ quantity_received: input.quantity_received, quantity_to_order: line.quantity_to_order }) -
          receptionExcess(line)
        line.quantity_received = input.quantity_received
        line.urrea_status = input.urrea_status
        if (delta === 0 || !line.model_code.trim()) continue
        const tag = line.etm || line.model_code || line.id
        const { clamped, missing } = stock.adjust(line.model_code, delta)
        if (missing) { warnings.push({ tag, model_code: line.model_code, kind: 'missing' }); continue }
        if (clamped) warnings.push({ tag, model_code: line.model_code, kind: 'clamped' })
        updated++
      }
      return { data: { inventory_updated: updated, warnings }, error: null }
    },
  }
  return { order, responses }
}
