/** save_order and save_order_reception (#155 D) through the real SDK: every stock move waits for the yes and goes through the atomic DB functions. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CallRecord, MockSupabaseClient } from '../helpers/supabase-mock'

const state = vi.hoisted(() => ({ db: null as unknown as MockSupabaseClient }))

vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => state.db), verifierClient: vi.fn() }))

import { createMockSupabase, filterValue } from '../helpers/supabase-mock'
import { connectMcp, textOf } from './harness'
import { TEST_PREVIEW_SECRET } from '../helpers/preview-secret'

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const QUOTATION_ID = '22222222-2222-4222-8222-222222222222'
const NEW_ORDER_ID = '33333333-3333-4333-8333-333333333333'
const id = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`
const parse = (text: string) => JSON.parse(text) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
})
afterEach(() => vi.unstubAllEnvs())

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const line = (n: number, over: Row = {}): Row => ({
  id: id(n), order_id: ORDER_ID, item_type: 'product', etm: `ETM-${n}`, model_code: `C${n}`, description: '', brand: 'URREA',
  quantity_approved: 10, quantity_in_stock: 4, quantity_to_order: 6, quantity_received: 0, urrea_status: 'pending',
  delivery_time: 'immediate', unit_price: 100, location: null, sort_order: n - 1, section_label: null, ...over,
})
const section = (n: number): Row => line(n, { item_type: 'separator',etm: '', model_code: '', quantity_approved: 0, quantity_in_stock: 0, quantity_to_order: 0, unit_price: 0 })

interface World {
  status?: string
  items?: Row[]
  inventory?: Record<string, number>
  linked?: { id: string; name: string; status: string } | null
  sameCustomer?: number
  twoMatches?: boolean
  quotationStatus?: string
}

function world({ status = 'ordered', items, inventory = { '6954': 3 }, linked = null, sameCustomer = 0, twoMatches = false, quotationStatus = 'approved' }: World = {}) {
  let rows = (items ?? [line(1), line(2, { model_code: 'C1' }), section(3)]).map((r) => ({ ...r }))
  const order: Row = { id: ORDER_ID, name: 'ORD-12', customer_name: 'GE', status, odoo_id: null, total_amount: 0, updated_at: '2026-10-20T00:00:00Z', created_at: '' }
  const quotation = {
    id: QUOTATION_ID, name: 'COT-7', customer_name: 'Andritz', status: quotationStatus, total_amount: 0, updated_at: '2026-10-20T00:00:00Z', created_at: '', approved_at: null,
    quotation_items: [
      { id: id(90), item_type: 'separator', section_label: 'Piezas', etm: '', is_approved: null, is_sold: null, sort_order: 0 },
      { id: id(91), item_type: 'product', etm: 'ETM-A', model_code: '6954', brand: 'URREA', description: 'Llave', quantity: 5, unit_price: 100, delivery_time: 'immediate', is_approved: true, is_sold: true, sort_order: 1 },
      { id: id(92), item_type: 'product', etm: 'ETM-B', model_code: 'ZZ', brand: 'URREA', description: 'Dado', quantity: 2, unit_price: 50, delivery_time: 'immediate', is_approved: false, is_sold: true, sort_order: 2 },
    ],
  }
  return createMockSupabase({
    responses: {
      'orders.select': (rec: CallRecord) => {
        if (rec.filters.some((f) => f.method === 'or')) {
          const list = [{ id: ORDER_ID, name: 'ORD-12', customer_name: 'GE', status }]
          return { data: twoMatches ? [...list, { id: NEW_ORDER_ID, name: 'ORD-13', customer_name: 'GE', status }] : list, error: null }
        }
        if (rec.filters.some((f) => f.method === 'eq' && f.args[0] === 'quotation_id')) return { data: linked, error: null }
        if (rec.columns === 'id') return { data: null, count: sameCustomer, error: null }
        if (rec.columns?.includes('order_items')) return { data: filterValue(rec, 'id') === ORDER_ID ? { ...order, status, order_items: rows.map((r) => ({ ...r })) } : null, error: null }
        return { data: filterValue(rec, 'id') === ORDER_ID ? { id: ORDER_ID, status } : null, error: null }
      },
      'orders.update': (rec: CallRecord) => {
        Object.assign(order, rec.payload)
        if ((rec.payload as Row).status) status = (rec.payload as Row).status
        return { data: { ...order, status }, error: null }
      },
      'orders.insert': (rec: CallRecord) => ({ data: { id: NEW_ORDER_ID, ...(rec.payload as object) }, error: null }),
      'order_items.select': (rec: CallRecord) => {
        if (rec.columns?.includes('unit_price')) return { data: rows.map((r) => ({ ...r })), error: null }
        const wanted = filterValue(rec, 'id')
        const row = rows.find((r) => r.id === wanted)
        return { data: row ? { ...row } : null, error: row ? null : { code: 'PGRST116' } }
      },
      'order_items.update': (rec: CallRecord) => {
        const wanted = filterValue(rec, 'id')
        rows = rows.map((r) => (r.id === wanted ? { ...r, ...(rec.payload as object) } : r))
        return { data: null, error: null }
      },
      'order_items.insert': { data: null, error: null },
      'store_inventory.select': () => ({ data: Object.entries(inventory).map(([model_code, quantity]) => ({ model_code, quantity })), error: null }),
      'quotations.select': (rec: CallRecord) => {
        if (rec.filters.some((f) => f.method === 'or')) return { data: [{ id: QUOTATION_ID, name: 'COT-7', customer_name: 'Andritz', status: quotationStatus }], error: null }
        return { data: filterValue(rec, 'id') === QUOTATION_ID ? quotation : null, error: filterValue(rec, 'id') === QUOTATION_ID ? null : { code: 'PGRST116' } }
      },
      'quotations.update': { data: null, error: null },
      'rpc.reserve_inventory': { data: [{ model_code: '6954', reserved: 3, location: 'A1' }], error: null },
      'rpc.cancel_order_restock': () => {
        status = 'cancelled'
        return { data: 7, error: null }
      },
      'rpc.remove_order_item_restock': (rec: CallRecord) => {
        const p = rec.payload as Row
        rows = rows.filter((r) => r.id !== p.p_item_id)
        return { data: 4, error: null }
      },
      'rpc.add_order_item': { data: { id: id(50) }, error: null },
      'rpc.receive_order_items': (rec: CallRecord) => {
        const p = rec.payload as { p_items: { id: string; quantity_received: number; urrea_status: string }[] }
        rows = rows.map((r) => {
          const next = p.p_items.find((i) => i.id === r.id)
          return next ? { ...r, quantity_received: next.quantity_received, urrea_status: next.urrea_status } : r
        })
        return { data: { inventory_updated: 1, warnings: [] }, error: null }
      },
    },
  })
}

async function open() {
  return connectMcp('admin')
}

async function both(tool: string, args: Record<string, unknown>) {
  const mcp = await open()
  try {
    const first = await mcp.call(tool, args)
    const key = first.isError ? null : parse(textOf(first)).clave
    const afterFirst = state.db._calls.filter((c) => c.op !== 'select').length + state.db._rpcCalls.length
    const second = key ? await mcp.call(tool, { ...args, clave: key }) : null
    return { first, second, afterFirst }
  } finally {
    await mcp.close()
  }
}

const call = async (tool: string, args: Record<string, unknown>) => {
  const mcp = await open()
  try {
    return await mcp.call(tool, args)
  } finally {
    await mcp.close()
  }
}

const writesOf = (db: MockSupabaseClient) => db._calls.filter((c) => c.op !== 'select').length + db._rpcCalls.length

describe('save_order: crear', () => {
  test('desde una cotización aprobada: la fase 1 muestra el stock que toma y lo que va a URREA sin escribir; con la clave crea, aparta y convierte', async () => {
    state.db = world()
    const { first, second, afterFirst } = await both('save_order', { cotizacion: 'COT-7' })
    expect(afterFirst).toBe(0)
    const one = parse(textOf(first))
    expect(one).toMatchObject({ accion: 'simulado', escrito: false })
    expect(one.orden).toMatchObject({ cotizacion: 'COT-7', cliente: 'Andritz', total: 500 })
    expect(one.orden.lineas).toEqual([expect.objectContaining({ etm: 'ETM-A', codigo: '6954', cantidad: 5, en_stock: 3, por_pedir: 2, importe: 500 })])
    expect(one.avisos.join(' ')).toMatch(/descuenta 3 piezas.*1 línea quedan por pedir.*convertida/s)
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(parse(textOf(second!))).toMatchObject({ accion: 'creado', escrito: true })
    expect(state.db.callsTo('orders', 'insert')[0].payload).toMatchObject({ quotation_id: QUOTATION_ID, customer_name: 'Andritz', status: 'ordered' })
    expect(state.db._rpcCalls.map((c) => c.fn)).toContain('reserve_inventory')
    expect(state.db.callsTo('quotations', 'update')[0].payload).toEqual({ status: 'converted_to_order' })
  })

  test('una cotización que no está aprobada o que ya tiene orden es un bloqueo sin clave', async () => {
    state.db = world({ quotationStatus: 'draft' })
    const draft = parse(textOf(await call('save_order', { cotizacion: 'COT-7' })))
    expect(draft.bloqueos[0]).toMatch(/solo una aprobada genera orden/)
    expect(draft).not.toHaveProperty('clave')
    state.db = world({ linked: { id: ORDER_ID, name: 'ORD-12', status: 'ordered' } })
    expect(parse(textOf(await call('save_order', { cotizacion: 'COT-7' }))).bloqueos).toEqual([expect.stringContaining('Ya tiene la orden ORD-12')])
    expect(writesOf(state.db)).toBe(0)
  })

  test('manual: cliente y productos; avisa si el cliente ya tiene órdenes y la huella cambia con ese conteo', async () => {
    state.db = world({ sameCustomer: 2 })
    const args = { cliente: 'Andritz', productos: [{ etm: 'ETM-A', codigo: '6954', cantidad: 5, precio: 100 }] }
    const { first, second } = await both('save_order', args)
    expect(parse(textOf(first)).avisos.join(' ')).toMatch(/orden manual.*ya tiene 2 órdenes/s)
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(state.db.callsTo('orders', 'insert')[0].payload).toMatchObject({ customer_name: 'Andritz', total_amount: 500 })

    // The same key after the order exists meets another fingerprint: a second order never slips in.
    state.db = world({ sameCustomer: 2 })
    const mcp = await open()
    try {
      const key = parse(textOf(await mcp.call('save_order', args))).clave
      state.db = world({ sameCustomer: 3 })
      expect(textOf(await mcp.call('save_order', { ...args, clave: key }))).toMatch(/cambió desde el resumen/)
    } finally {
      await mcp.close()
    }
    expect(state.db.callsTo('orders', 'insert')).toEqual([])
  })
})

describe('save_order: estado', () => {
  test('cancelar: la fase 1 dice qué vuelve al inventario y que no se deshace; con la clave llama a la función atómica con el estado esperado', async () => {
    state.db = world()
    const { first, second, afterFirst } = await both('save_order', { orden: 'ORD-12', estado: 'cancelada' })
    expect(afterFirst).toBe(0)
    const one = parse(textOf(first))
    expect(one.cambios.estado).toEqual({ antes: 'pedida', ahora: 'cancelada' })
    expect(one.avisos.join(' ')).toMatch(/Devuelve al inventario: C1 ×8.*no se deshace/s)
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(state.db.rpcParams('cancel_order_restock')).toEqual([{ p_order_id: ORDER_ID, p_expected_status: 'ordered' }])
  })

  test('una entregada no regresa a recibida ni se cancela; una cancelada ya no cambia', async () => {
    state.db = world({ status: 'delivered' })
    expect(parse(textOf(await call('save_order', { orden: 'ORD-12', estado: 'recibida' }))).bloqueos[0]).toMatch(/no puede regresar/)
    expect(parse(textOf(await call('save_order', { orden: 'ORD-12', estado: 'cancelada' }))).bloqueos[0]).toMatch(/ya salió con el cliente/)
    state.db = world({ status: 'cancelled' })
    expect(parse(textOf(await call('save_order', { orden: 'ORD-12', estado: 'pedida' }))).bloqueos[0]).toMatch(/cancelada ya no cambia/)
    expect(writesOf(state.db)).toBe(0)
  })

  test('entregar pide el sí, usa la ruta de estado y el mismo estado es sin_cambios', async () => {
    state.db = world({ status: 'received' })
    const { second } = await both('save_order', { orden: 'ORD-12', estado: 'entregada' })
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(state.db.callsTo('orders', 'update')[0].payload).toEqual({ status: 'delivered' })
    state.db = world({ status: 'delivered' })
    expect(parse(textOf(await call('save_order', { orden: 'ORD-12', estado: 'entregada' }))).accion).toBe('sin_cambios')
  })
})

describe('save_order: odoo_id y líneas', () => {
  test('el id de Odoo es directo: sin clave, escribe una vez; vacío lo quita; igual es sin_cambios', async () => {
    state.db = world()
    const result = await call('save_order', { orden: 'ORD-12', odoo_id: ' S00045 ' })
    expect(parse(textOf(result))).toMatchObject({ accion: 'actualizado', escrito: true })
    expect(state.db.callsTo('orders', 'update')[0].payload).toEqual({ odoo_id: 'S00045' })
    state.db = world()
    expect(parse(textOf(await call('save_order', { orden: 'ORD-12', odoo_id: '' }))).accion).toBe('sin_cambios')
  })

  test('solo la entrega de una línea es directa; el precio pide el sí y muestra el total antes y después', async () => {
    state.db = world()
    const direct = await call('save_order', { orden: 'ORD-12', cambios: [{ linea: 1, entrega: '1_semana' }] })
    expect(parse(textOf(direct))).toMatchObject({ accion: 'actualizado', escrito: true })
    expect(state.db.callsTo('order_items', 'update')[0].payload).toEqual({ delivery_time: '1_week' })

    state.db = world()
    const { first, second, afterFirst } = await both('save_order', { orden: 'ORD-12', cambios: [{ linea: 1, etm: 'etm-1', precio: 150 }] })
    expect(afterFirst).toBe(0)
    expect(parse(textOf(first)).cambios.total).toEqual({ antes: 2000, ahora: 2500 })
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(state.db.callsTo('order_items', 'update')[0].payload).toEqual({ unit_price: 150 })
  })

  test('quitar devuelve el stock por la función atómica y lo avisa; agregar toma del inventario y lo muestra', async () => {
    state.db = world()
    const removed = await both('save_order', { orden: 'ORD-12', cambios: [{ linea: 2, quitar: true }] })
    expect(parse(textOf(removed.first)).avisos.join(' ')).toMatch(/Quitar devuelve 4 piezas/)
    expect(removed.second?.isError, textOf(removed.second!)).toBeFalsy()
    expect(state.db.rpcParams('remove_order_item_restock')[0]).toMatchObject({ p_order_id: ORDER_ID, p_item_id: id(2) })

    state.db = world()
    const added = await both('save_order', { orden: 'ORD-12', productos: [{ etm: 'ETM-A', codigo: '6954', cantidad: 5, precio: 100 }] })
    expect(parse(textOf(added.first)).cambios['linea nueva 1'].ahora).toMatch(/en stock 3, por pedir 2/)
    expect(added.second?.isError, textOf(added.second!)).toBeFalsy()
    expect(state.db.rpcParams('add_order_item')[0]).toMatchObject({ p_order_id: ORDER_ID, p_item: { etm: 'ETM-A', model_code: '6954', quantity_approved: 5, unit_price: 100 } })
  })

  test('errores: dos intenciones, línea que no existe, ETM que no es el de la línea, sección, línea repetida, orden cerrada', async () => {
    state.db = world()
    expect(textOf(await call('save_order', { orden: 'ORD-12', estado: 'entregada', odoo_id: 'X' }))).toMatch(/Una intención por llamada/)
    expect(textOf(await call('save_order', { orden: 'ORD-12', cambios: [{ linea: 9, precio: 1 }] }))).toMatch(/no hay línea 9: la orden tiene 3/)
    expect(textOf(await call('save_order', { orden: 'ORD-12', cambios: [{ linea: 1, etm: 'OTRO', precio: 1 }] }))).toMatch(/es el ETM ETM-1, no OTRO/)
    expect(textOf(await call('save_order', { orden: 'ORD-12', cambios: [{ linea: 3, precio: 1 }] }))).toMatch(/es una sección/)
    expect(textOf(await call('save_order', { orden: 'ORD-12', cambios: [{ linea: 1, precio: 1 }, { linea: 1, precio: 2 }] }))).toMatch(/viene dos veces/)
    expect(textOf(await call('save_order', { orden: 'ORD-12', cambios: [{ linea: 1 }] }))).toMatch(/indica qué cambiar/)
    expect(textOf(await call('save_order', { orden: 'ORD-12' }))).toMatch(/Indica qué hacer/)
    expect(textOf(await call('save_order', { estado: 'entregada' }))).toMatch(/indica `orden`/)
    state.db = world({ status: 'completed' })
    expect(textOf(await call('save_order', { orden: 'ORD-12', cambios: [{ linea: 1, precio: 1 }] }))).toMatch(/completada o cancelada no se modifica/)
    state.db = world({ status: 'delivered' })
    expect(textOf(await call('save_order', { orden: 'ORD-12', cambios: [{ linea: 1, quitar: true }] }))).toMatch(/ya salió con el cliente/)
    expect(writesOf(state.db)).toBe(0)
  })

  test('un campo desconocido es error; un nombre con dos coincidencias lista las dos y no adivina', async () => {
    state.db = world()
    expect((await call('save_order', { orden: 'ORD-12', odoo_id: 'X', inventado: 1 })).isError).toBe(true)
    state.db = world({ twoMatches: true })
    const ambiguous = await call('save_order', { orden: 'GE', odoo_id: 'X' })
    expect(ambiguous.isError).toBe(true)
    expect(textOf(ambiguous)).toMatch(/ORD-12.*ORD-13/s)
    expect(writesOf(state.db)).toBe(0)
  })

  test('REGLA: repetir la clave después de escribir no escribe otra vez; si la orden cambió entre el resumen y el sí, tampoco', async () => {
    state.db = world()
    const mcp = await open()
    const args = { orden: 'ORD-12', cambios: [{ linea: 1, precio: 150 }] }
    try {
      const key = parse(textOf(await mcp.call('save_order', args))).clave
      await mcp.call('save_order', { ...args, clave: key })
      const again = await mcp.call('save_order', { ...args, clave: key })
      // The fingerprint moved with the write itself, so the used key no longer opens anything.
      expect(textOf(again)).toMatch(/cambió desde el resumen/)
    } finally {
      await mcp.close()
    }
    expect(state.db.callsTo('order_items', 'update')).toHaveLength(1)

    state.db = world()
    const second = await open()
    try {
      const key = parse(textOf(await second.call('save_order', args))).clave
      state.db = world({ items: [line(1, { quantity_in_stock: 5, quantity_to_order: 5 }), line(2), section(3)] })
      expect(textOf(await second.call('save_order', { ...args, clave: key }))).toMatch(/cambió desde el resumen/)
    } finally {
      await second.close()
    }
    expect(state.db.callsTo('order_items', 'update')).toEqual([])
  })

  test('sin MCP_PREVIEW_SECRET falla cerrado; un member ni la recibe', async () => {
    state.db = world()
    vi.stubEnv('MCP_PREVIEW_SECRET', '')
    expect(textOf(await call('save_order', { orden: 'ORD-12', estado: 'cancelada' }))).toMatch(/todavía no está activada/)
    const member = await connectMcp('member')
    try {
      expect((await member.tools()).map((t) => t.name)).not.toContain('save_order')
      expect((await member.tools()).map((t) => t.name)).not.toContain('save_order_reception')
    } finally {
      await member.close()
    }
    expect(writesOf(state.db)).toBe(0)
  })
})

describe('save_order_reception', () => {
  const pending = [line(1, { quantity_to_order: 10, quantity_in_stock: 0, quantity_approved: 10, model_code: '6954' }), line(2, { quantity_to_order: 0, quantity_in_stock: 10, model_code: '4410' }), section(3)]

  test('eval: llegaron 12 de 10 pedidos — la fase 1 muestra excedente al inventario, estado surtida y total de entrega sin escribir; con la clave llama a receive_order_items', async () => {
    state.db = world({ items: pending })
    const { first, second, afterFirst } = await both('save_order_reception', { orden: 'ORD-12', lineas: [{ codigo: '6954', recibido: 12 }] })
    expect(afterFirst).toBe(0)
    const one = parse(textOf(first))
    expect(one).toMatchObject({ accion: 'simulado', escrito: false })
    expect(one.recepcion.lineas).toEqual([{ linea: 1, etm: 'ETM-1', codigo: '6954', pedido: 10, recibido: { antes: 0, ahora: 12 }, estado: 'surtido', a_tienda: 2 }])
    expect(one.cambios.inventario_tienda.ahora).toBe('+2 piezas')
    expect(one.cambios.total_entrega).toEqual({ antes: 1000, ahora: 2000 })
    expect(one.avisos.join(' ')).toMatch(/2 piezas de excedente entran al inventario/)
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(state.db.rpcParams('receive_order_items')).toEqual([{ p_order_id: ORDER_ID, p_items: [{ id: id(1), quantity_received: 12, urrea_status: 'supplied' }] }])
  })

  test('una recepción parcial no cambia el estado; un estado elegido a mano gana; más del doble de lo pedido avisa', async () => {
    state.db = world({ items: pending })
    const partial = parse(textOf(await call('save_order_reception', { orden: 'ORD-12', lineas: [{ linea: 1, recibido: 4 }] })))
    expect(partial.recepcion.lineas[0]).toMatchObject({ estado: 'pendiente', a_tienda: 0 })
    const manual = parse(textOf(await call('save_order_reception', { orden: 'ORD-12', lineas: [{ linea: 1, recibido: 4, estado: 'no_surtido' }] })))
    expect(manual.recepcion.lineas[0].estado).toBe('no_surtido')
    const wild = parse(textOf(await call('save_order_reception', { orden: 'ORD-12', lineas: [{ linea: 1, recibido: 25 }] })))
    expect(wild.avisos.join(' ')).toMatch(/más del doble de lo pedido/)
    expect(writesOf(state.db)).toBe(0)
  })

  test('errores: código que la orden no trae, código en dos líneas, línea de stock completo, sección, línea repetida, sin código ni línea', async () => {
    state.db = world({ items: [...pending, line(4, { model_code: '6954', quantity_to_order: 3 })] })
    expect(textOf(await call('save_order_reception', { orden: 'ORD-12', lineas: [{ codigo: 'NOPE', recibido: 1 }] }))).toMatch(/no trae el código NOPE/)
    expect(textOf(await call('save_order_reception', { orden: 'ORD-12', lineas: [{ codigo: '6954', recibido: 1 }] }))).toMatch(/está en 2 líneas \(1, 4\): indica `linea`/)
    expect(textOf(await call('save_order_reception', { orden: 'ORD-12', lineas: [{ linea: 2, recibido: 1 }] }))).toMatch(/no se pidió a URREA/)
    expect(textOf(await call('save_order_reception', { orden: 'ORD-12', lineas: [{ linea: 3, recibido: 1 }] }))).toMatch(/es una sección/)
    expect(textOf(await call('save_order_reception', { orden: 'ORD-12', lineas: [{ linea: 1, recibido: 1 }, { linea: 1, recibido: 2 }] }))).toMatch(/viene dos veces/)
    expect(textOf(await call('save_order_reception', { orden: 'ORD-12', lineas: [{ recibido: 1 }] }))).toMatch(/indica el `codigo` o la `linea`/)
    expect((await call('save_order_reception', { orden: 'ORD-12', lineas: [{ linea: 1, recibido: -1 }] })).isError).toBe(true)
    state.db = world({ items: pending, status: 'cancelled' })
    expect(textOf(await call('save_order_reception', { orden: 'ORD-12', lineas: [{ linea: 1, recibido: 1 }] }))).toMatch(/no recibe/)
    expect(writesOf(state.db)).toBe(0)
  })

  test('REGLA: repetir la clave después de recibir es sin_cambios; si la orden cambió entre el resumen y el sí, no escribe', async () => {
    state.db = world({ items: pending })
    const mcp = await open()
    const args = { orden: 'ORD-12', lineas: [{ codigo: '6954', recibido: 10 }] }
    try {
      const key = parse(textOf(await mcp.call('save_order_reception', args))).clave
      await mcp.call('save_order_reception', { ...args, clave: key })
      const again = await mcp.call('save_order_reception', { ...args, clave: key })
      expect(parse(textOf(again))).toMatchObject({ accion: 'sin_cambios', escrito: false })
    } finally {
      await mcp.close()
    }
    expect(state.db._rpcCalls.filter((c) => c.fn === 'receive_order_items')).toHaveLength(1)

    state.db = world({ items: pending })
    const second = await open()
    try {
      const key = parse(textOf(await second.call('save_order_reception', args))).clave
      state.db = world({ items: [line(1, { quantity_to_order: 10, quantity_in_stock: 0, quantity_approved: 10, model_code: '6954', quantity_received: 3 }), ...pending.slice(1)] })
      expect(textOf(await second.call('save_order_reception', { ...args, clave: key }))).toMatch(/cambió desde el resumen/)
    } finally {
      await second.close()
    }
    expect(state.db._rpcCalls.filter((c) => c.fn === 'receive_order_items')).toEqual([])
  })
})
