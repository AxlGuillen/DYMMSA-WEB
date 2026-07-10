/** Tools MCP de órdenes. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue } from '../helpers/supabase-mock'
import { listOrders, getOrder, getOrderByQuotation } from '@/lib/mcp/tools/orders'
import { type Db } from '@/lib/mcp/shared'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

describe('listOrders', () => {
  test('mapea items_count y filtra por status', async () => {
    const client = createMockSupabase({
      responses: {
        orders: {
          data: [
            { id: 'o1', name: 'Orden A', customer_name: 'ACME', status: 'ordered', total_amount: 500, quotation_id: 'q1', created_at: '2026-07-01', order_items: [{ count: 4 }] },
          ],
          count: 1,
        },
      },
    })

    const result = await listOrders(asDb(client), { status: 'ordered' })

    expect(result.orders[0]).toMatchObject({ id: 'o1', items_count: 4 })
    expect(filterValue(client.callsTo('orders', 'select')[0], 'status')).toBe('ordered')
  })
})

describe('getOrder', () => {
  test('total con business-rules y conteo de pendientes URREA; separador incluido como sección', async () => {
    const items = [
      { item_type: 'separator', section_label: 'Herramienta', unit_price: 0, quantity_approved: 0 },
      { item_type: 'product', etm: 'E1', model_code: 'M1', brand: 'URREA', description: 'D1', quantity_approved: 5, quantity_in_stock: 2, quantity_to_order: 3, quantity_received: 0, urrea_status: 'pending', delivery_time: 'immediate', unit_price: 10, location: 'G-1' },
      { item_type: 'product', etm: 'E2', model_code: 'M2', brand: 'URREA', description: 'D2', quantity_approved: 1, quantity_in_stock: 1, quantity_to_order: 0, quantity_received: 0, urrea_status: 'pending', delivery_time: 'immediate', unit_price: 100, location: null },
    ]
    const client = createMockSupabase({
      responses: {
        orders: {
          data: { id: 'o1', name: 'Orden', customer_name: 'ACME', status: 'ordered', quotation_id: 'q1', notes: null, created_at: '', updated_at: '', order_items: items },
        },
      },
    })

    const result = await getOrder(asDb(client), 'o1')

    expect(result.total).toBe(150) // 5*10 + 1*100, separador excluido
    expect(result.items_count).toBe(2)
    // Solo E1 está pendiente con URREA Y tiene quantity_to_order > 0
    expect(result.pending_urrea_items).toBe(1)
    expect(result.items[0]).toEqual({ item_type: 'separator', section_label: 'Herramienta' })
  })

  test('PGRST116 → "Orden no encontrada"', async () => {
    const client = createMockSupabase({
      responses: { orders: { data: null, error: { code: 'PGRST116', message: 'x' } } },
    })
    await expect(getOrder(asDb(client), 'nope')).rejects.toThrow('Orden no encontrada')
  })
})

describe('getOrderByQuotation', () => {
  test('devuelve la orden vinculada', async () => {
    const client = createMockSupabase({
      responses: { orders: { data: { id: 'o1', name: 'Orden', status: 'ordered' } } },
    })
    const result = await getOrderByQuotation(asDb(client), 'q1')
    expect(result).toMatchObject({ id: 'o1' })
  })

  test('sin orden vinculada devuelve mensaje explícito (no null crudo)', async () => {
    const client = createMockSupabase({ responses: { orders: { data: null } } })
    const result = await getOrderByQuotation(asDb(client), 'q1')
    expect(result).toEqual({ message: 'Esta cotización no tiene una orden vinculada' })
  })
})
