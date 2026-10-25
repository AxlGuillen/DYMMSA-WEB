/** MCP order tools. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue, type CallRecord } from '../helpers/supabase-mock'
import { listOrders, getOrder, findOrderByQuotation } from '@/lib/mcp/tools/orders'
import type { Db } from '@/lib/mcp/core/db'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

const O1 = '9e8d7c6b-1a2b-4c3d-8e4f-0123456789cd'
const Q1 = '3f2a9c1b-5d7e-4a10-8b31-0123456789ab'

describe('listOrders', () => {
  test('mapea lineas, estado en español y refs; filtra con el valor de la BD', async () => {
    const client = createMockSupabase({
      responses: {
        orders: {
          data: [
            { id: O1, name: 'Orden A', customer_name: 'ACME', status: 'ordered', total_amount: 500, quotation_id: Q1, created_at: '2026-07-01', order_items: [{ count: 4 }] },
          ],
          count: 1,
        },
      },
    })

    const result = await listOrders(asDb(client), { estado: 'pedida' })

    expect(result).toMatchObject({ total: 1, pagina: 1, por_pagina: 20, hay_mas: false })
    expect(result.ordenes).toEqual([
      { ref: '9e8d7c6b', nombre: 'Orden A', cliente: 'ACME', estado: 'pedida', total_sellado: 500, cotizacion: { ref: '3f2a9c1b' }, lineas: 4, creada_el: '2026-07-01' },
    ])
    expect(filterValue(client.callsTo('orders', 'select')[0], 'status')).toBe('ordered')
  })

  test('un estado fuera de los tokens es error, también el token en inglés', async () => {
    const client = createMockSupabase({ responses: { orders: { data: [], count: 0 } } })
    await expect(listOrders(asDb(client), { estado: 'ordered' })).rejects.toThrow(/Estado inválido "ordered": usa pedida \| recibida/)
    expect(client.callsTo('orders', 'select')).toEqual([])
  })
})

describe('getOrder', () => {
  const items = [
    { id: 'i1', item_type: 'separator', section_label: 'Herramienta', unit_price: 0, quantity_approved: 0 },
    { id: 'i2', item_type: 'product', etm: 'E1', model_code: 'M1', brand: 'URREA', description: 'D1', quantity_approved: 5, quantity_in_stock: 2, quantity_to_order: 3, quantity_received: 0, urrea_status: 'pending', delivery_time: '1_week', unit_price: 10, location: 'G-1' },
    { id: 'i3', item_type: 'product', etm: 'E2', model_code: 'M2', brand: 'URREA', description: 'D2', quantity_approved: 1, quantity_in_stock: 1, quantity_to_order: 0, quantity_received: 0, urrea_status: 'not_supplied', delivery_time: 'immediate', unit_price: 100, location: null },
  ]
  const row = (extra: Record<string, unknown> = {}) => ({
    id: O1, name: 'Orden', customer_name: 'ACME', status: 'ordered', quotation_id: Q1, notes: null, created_at: '', updated_at: '2026-10-01T10:00:00Z', order_items: items, ...extra,
  })

  test('total con business-rules y conteo de pendientes URREA; las líneas se numeran incluida la sección', async () => {
    const client = createMockSupabase({ responses: { orders: { data: row() } } })

    const result = await getOrder(asDb(client), O1)

    expect(result).toMatchObject({ ref: '9e8d7c6b', estado: 'pedida', cotizacion: { ref: '3f2a9c1b' }, total: 150, productos: 2, pendientes_con_urrea: 1 })
    expect(result.lineas[0]).toEqual({ linea: 1, tipo: 'seccion', titulo: 'Herramienta' })
    expect(result.lineas[1]).toMatchObject({ linea: 2, codigo: 'M1', cantidad_aprobada: 5, por_pedir: 3, estado_urrea: 'pendiente', entrega: '1_semana', ubicacion: 'G-1' })
    expect(result.lineas[2]).toMatchObject({ linea: 3, estado_urrea: 'no_surtido', entrega: 'inmediata', ubicacion: null })
    expect(result.version).toMatch(/^[0-9a-f]{12}$/)
    expect(JSON.stringify(result)).not.toContain(O1)
  })

  test('acepta nombre o cliente, y varias coincidencias piden precisar', async () => {
    const two = createMockSupabase({
      responses: { orders: (rec: CallRecord) => ({ data: rec.filters.some((f) => f.method === 'or') ? [row(), row({ id: Q1, name: 'Orden 2' })] : row(), error: null }) },
    })
    await expect(getOrder(asDb(two), 'ACME')).rejects.toThrow(/Hay 2 coincidencias \(Orden \(ACME\) \[ref 9e8d7c6b\], Orden 2 \(ACME\) \[ref 3f2a9c1b\]\)/)
  })

  test('PGRST116 → "Orden no encontrada"', async () => {
    const client = createMockSupabase({
      responses: { orders: (rec: CallRecord) => (rec.columns?.startsWith('*') ? { data: null, error: { code: 'PGRST116', message: 'x' } } : { data: { id: O1, name: 'O', customer_name: 'X', status: 'ordered' }, error: null }) },
    })
    await expect(getOrder(asDb(client), O1)).rejects.toThrow('Orden no encontrada')
  })
})

describe('findOrderByQuotation', () => {
  test('devuelve la orden vinculada', async () => {
    const client = createMockSupabase({
      responses: { orders: { data: { id: O1, name: 'Orden', status: 'ordered' } } },
    })
    const result = await findOrderByQuotation(asDb(client), Q1)
    expect(result).toMatchObject({ id: O1 })
  })

  test('sin orden vinculada devuelve null', async () => {
    const client = createMockSupabase({ responses: { orders: { data: null } } })
    expect(await findOrderByQuotation(asDb(client), Q1)).toBeNull()
  })
})
