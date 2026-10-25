/** save_inventory_item with quantities (#155 D) through the real SDK: a count is the physical stock minus what open orders hold. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CallRecord, MockSupabaseClient } from '../helpers/supabase-mock'

const state = vi.hoisted(() => ({ db: null as unknown as MockSupabaseClient }))

vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => state.db), verifierClient: vi.fn() }))

import { createMockSupabase, filterValue } from '../helpers/supabase-mock'
import { connectMcp, textOf } from './harness'
import { TEST_PREVIEW_SECRET } from '../helpers/preview-secret'

const parse = (text: string) => JSON.parse(text) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
})
afterEach(() => vi.unstubAllEnvs())

const row = (model_code: string, quantity: number, location: string | null = null) => ({ model_code, quantity, location })
const held = (model_code: string, in_stock: number, received = 0, to_order = 0, item_type = 'product') => ({
  model_code, quantity_in_stock: in_stock, quantity_received: received, quantity_to_order: to_order, item_type, orders: { status: 'ordered' },
})

interface World {
  stock?: ReturnType<typeof row>[]
  orders?: ReturnType<typeof held>[]
  rpc?: (params: Record<string, unknown>) => { data: unknown; error: unknown }
}

/** store_inventory by ilike on the code; order_items for what orders hold; the RPC records its calls. */
function world({ stock = [row('6954', 12)], orders = [], rpc }: World = {}) {
  const table = [...stock]
  return createMockSupabase({
    responses: {
      'store_inventory.select': (rec: CallRecord) => ({
        data: table.filter((r) => r.model_code.toLowerCase() === String(filterValue(rec, 'model_code', 'ilike')).toLowerCase().replace(/\\/g, '')),
        error: null,
      }),
      'store_inventory.update': (rec: CallRecord) => {
        const target = table.find((r) => r.model_code === filterValue(rec, 'model_code', 'eq'))
        if (target) Object.assign(target, rec.payload)
        return { data: target ? [target] : [], error: null }
      },
      'store_inventory.insert': (rec: CallRecord) => ({ data: { id: 'new', ...(rec.payload as object) }, error: null }),
      'order_items.select': { data: orders, error: null },
      'rpc.change_store_stock': (rec: CallRecord) => {
        const params = rec.payload as Record<string, unknown>
        if (rpc) return rpc(params)
        const target = table.find((r) => r.model_code === params.p_model_code)
        if (params.p_mode === 'count') {
          if (!target || target.quantity !== params.p_expected) return { data: { quantity: null, changed: false, missing: !target }, error: null }
          target.quantity = params.p_value as number
          return { data: { quantity: target.quantity, changed: true, missing: false }, error: null }
        }
        if (!target) table.push(row(String(params.p_model_code), params.p_value as number))
        else target.quantity = Math.max(0, target.quantity + (params.p_value as number))
        return { data: { quantity: table.find((r) => r.model_code === params.p_model_code)!.quantity, clamped: false, missing: false }, error: null }
      },
    },
  })
}

const open = () => connectMcp('admin')

async function both(args: Record<string, unknown>) {
  const mcp = await open()
  try {
    const first = await mcp.call('save_inventory_item', args)
    const key = first.isError ? null : parse(textOf(first)).clave
    const afterFirst = state.db._calls.filter((c) => c.op !== 'select').length + state.db._rpcCalls.length
    const second = key ? await mcp.call('save_inventory_item', { ...args, clave: key }) : null
    return { first, second, afterFirst }
  } finally {
    await mcp.close()
  }
}

const call = async (args: Record<string, unknown>) => {
  const mcp = await open()
  try {
    return await mcp.call('save_inventory_item', args)
  } finally {
    await mcp.close()
  }
}

describe('save_inventory_item: conteo físico', () => {
  test('decisión 6: «conté 12» guarda 12 menos lo que las órdenes abiertas tienen apartado, y el resumen muestra el desglose', async () => {
    // Open orders hold 3 taken from stock + 2 received for the customer (min(received, ordered) = 2) = 5.
    state.db = world({ stock: [row('6954', 4, 'A1')], orders: [held('6954', 3, 2, 4), held('6954', 0, 0, 1, 'separator')] })
    const { first, second, afterFirst } = await both({ productos: [{ codigo: '6954', cantidad_contada: 12, ubicacion: 'B3' }], motivo: 'conteo del 24 de octubre' })
    expect(afterFirst).toBe(0)
    const one = parse(textOf(first))
    expect(one).toMatchObject({ accion: 'simulado', escrito: false, productos: [{ codigo: '6954', cantidad: 7, apartado_en_ordenes: 5, ubicacion: 'B3' }] })
    expect(one.cambios).toEqual({ 'cantidad 6954': { antes: 4, ahora: 7 }, 'ubicacion 6954': { antes: 'A1', ahora: 'B3' } })
    expect(one.avisos).toContain('«6954»: contaste 12 y las órdenes abiertas tienen apartadas 5, así que quedan 7 disponibles.')
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(state.db.rpcParams('change_store_stock')).toEqual([{ p_model_code: '6954', p_mode: 'count', p_value: 7, p_expected: 4, p_reason: 'conteo del 24 de octubre' }])
    expect(state.db.updatePayload('store_inventory')).toEqual({ location: 'B3' })
  })

  test('sin órdenes abiertas se guarda lo contado tal cual', async () => {
    state.db = world()
    const { first } = await both({ productos: [{ codigo: '6954', cantidad_contada: 9 }], motivo: 'conteo' })
    expect(parse(textOf(first)).cambios).toEqual({ 'cantidad 6954': { antes: 12, ahora: 9 } })
    expect(state.db.rpcParams('change_store_stock')[0]).toMatchObject({ p_value: 9, p_expected: 12 })
  })

  test('si contaste menos de lo que las órdenes apartan es un bloqueo sin clave', async () => {
    state.db = world({ orders: [held('6954', 10)] })
    const { first, second } = await both({ productos: [{ codigo: '6954', cantidad_contada: 4 }], motivo: 'conteo' })
    expect(parse(textOf(first)).bloqueos).toEqual(['«6954»: contaste 4 pero las órdenes abiertas ya tienen apartadas 10. Revisa el conteo o esas órdenes.'])
    expect(parse(textOf(first))).not.toHaveProperty('clave')
    expect(second).toBeNull()
    expect(state.db._rpcCalls).toEqual([])
  })

  test('REGLA: la cantidad se escribe con compare-and-set: si el stock cambió después del resumen, el sí falla y no pisa', async () => {
    state.db = world()
    const mcp = await open()
    try {
      const args = { productos: [{ codigo: '6954', cantidad_contada: 9 }], motivo: 'conteo' }
      const first = parse(textOf(await mcp.call('save_inventory_item', args)))
      // The plan reads again before writing: another order took 2, so the fingerprint is different.
      state.db = world({ stock: [row('6954', 10)] })
      const second = await mcp.call('save_inventory_item', { ...args, clave: first.clave })
      expect(textOf(second)).toBe('El inventario cambió desde el resumen: vuelve a pedirlo. No escribí nada.')
      expect(state.db._rpcCalls).toEqual([])
    } finally {
      await mcp.close()
    }
  })

  test('si entre el último plan y el UPDATE se coló una orden, el compare-and-set no escribe y lo dice', async () => {
    state.db = world({ rpc: () => ({ data: { quantity: null, changed: false, missing: false }, error: null }) })
    const { second } = await both({ productos: [{ codigo: '6954', cantidad_contada: 9 }], motivo: 'conteo' })
    expect(second?.isError).toBe(true)
    expect(textOf(second!)).toBe('su cantidad cambió desde el resumen (otra orden o conteo): vuelve a pedirlo')
  })

  test('REGLA: repetir la clave después de contar no vuelve a escribir (el stock ya es el contado)', async () => {
    state.db = world()
    const mcp = await open()
    try {
      const args = { productos: [{ codigo: '6954', cantidad_contada: 9 }], motivo: 'conteo' }
      const key = parse(textOf(await mcp.call('save_inventory_item', args))).clave
      await mcp.call('save_inventory_item', { ...args, clave: key })
      const again = await mcp.call('save_inventory_item', { ...args, clave: key })
      expect(parse(textOf(again))).toMatchObject({ accion: 'sin_cambios', escrito: false })
    } finally {
      await mcp.close()
    }
    expect(state.db.rpcParams('change_store_stock')).toHaveLength(1)
  })
})

describe('save_inventory_item: ajuste, alta, gaveta', () => {
  test('el ajuste es un delta por adjust_inventory; restar de más baja a 0 y lo avisa', async () => {
    state.db = world({ stock: [row('6954', 2)] })
    const { first, second } = await both({ productos: [{ codigo: '6954', ajuste: -5 }], motivo: 'se rompieron' })
    const one = parse(textOf(first))
    expect(one.cambios).toEqual({ 'cantidad 6954': { antes: 2, ahora: 0 } })
    expect(one.avisos).toContain('«6954»: hay 2 y se restan 5; queda en 0 (la cantidad nunca es negativa).')
    expect(second?.isError).toBeFalsy()
    expect(state.db.rpcParams('change_store_stock')).toEqual([{ p_model_code: '6954', p_mode: 'delta', p_value: -5, p_expected: null, p_reason: 'se rompieron' }])
  })

  test('toda cantidad lleva motivo; contada y ajuste no van juntos; un ajuste 0 o una línea sin nada son errores', async () => {
    state.db = world()
    expect(textOf(await call({ productos: [{ codigo: '6954', ajuste: 1 }] }))).toMatch(/lleva su `motivo`/)
    expect(textOf(await call({ productos: [{ codigo: '6954', ajuste: 1, cantidad_contada: 3 }], motivo: 'x' }))).toMatch(/no van juntos/)
    expect(textOf(await call({ productos: [{ codigo: '6954', ajuste: 0 }], motivo: 'x' }))).toMatch(/ajuste de 0/)
    expect(textOf(await call({ productos: [{ codigo: '6954' }] }))).toMatch(/indica `ubicacion`, `cantidad_contada` o `ajuste`/)
    expect(state.db._rpcCalls).toEqual([])
  })

  test('un código que no existe pide `crear: true`; con él se da de alta (en mayúsculas) con su cantidad por la misma puerta', async () => {
    state.db = world({ stock: [] })
    expect(textOf(await call({ productos: [{ codigo: '1234x', cantidad_contada: 3 }], motivo: 'alta' }))).toMatch(/Para darlo de alta repite con `crear: true`/)
    const { first, second } = await both({ productos: [{ codigo: ' 1234x ', cantidad_contada: 3 }], crear: true, motivo: 'alta' })
    expect(parse(textOf(first)).avisos).toContain('«1234X» entra al inventario con 3 disponibles: la siguiente orden los toma.')
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(state.db.rpcParams('change_store_stock')).toEqual([{ p_model_code: '1234X', p_mode: 'delta', p_value: 3, p_expected: null, p_reason: 'alta' }])
  })

  test('un código nuevo solo con gaveta se inserta en 0; restarle a uno que no existe es error', async () => {
    state.db = world({ stock: [] })
    const { second } = await both({ productos: [{ codigo: 'nuevo1', ubicacion: 'C2' }], crear: true })
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(state.db.callsTo('store_inventory', 'insert')[0].payload).toEqual({ model_code: 'NUEVO1', quantity: 0, location: 'C2' })
    expect(textOf(await call({ productos: [{ codigo: 'nope', ajuste: -1 }], crear: true, motivo: 'x' }))).toMatch(/no se le puede restar/)
  })

  test('solo la gaveta es directa: una llamada, sin clave y sin motivo; no toca cantidades ni la bitácora', async () => {
    state.db = world({ stock: [row('6954', 12, 'A1')] })
    const result = await call({ productos: [{ codigo: '6954', ubicacion: 'B3' }] })
    expect(parse(textOf(result))).toMatchObject({ accion: 'actualizado', escrito: true, productos: [{ codigo: '6954', cantidad: 12, ubicacion: 'B3' }] })
    expect(result.isError).toBeFalsy()
    expect(state.db._rpcCalls).toEqual([])
  })

  test('sin MCP_PREVIEW_SECRET la gaveta sigue directa y las cantidades fallan cerrado; un member ni la recibe', async () => {
    state.db = world()
    vi.stubEnv('MCP_PREVIEW_SECRET', '')
    expect(parse(textOf(await call({ productos: [{ codigo: '6954', ubicacion: 'B3' }] }))).accion).toBe('actualizado')
    expect(textOf(await call({ productos: [{ codigo: '6954', cantidad_contada: 3 }], motivo: 'x' }))).toMatch(/todavía no está activada/)
    const member = await connectMcp('member')
    try {
      expect((await member.tools()).map((t) => t.name)).not.toContain('save_inventory_item')
    } finally {
      await member.close()
    }
    expect(state.db._rpcCalls).toEqual([])
  })

  test('search_inventory con un código exacto trae lo apartado en órdenes abiertas', async () => {
    state.db = world({ orders: [held('6954', 3, 2, 4)] })
    state.db = createMockSupabase({
      responses: {
        'store_inventory.select': { data: [{ model_code: '6954', quantity: 4, location: null, updated_at: '' }], count: 1 },
        'order_items.select': { data: [held('6954', 3, 2, 4)], error: null },
      },
    })
    const mcp = await open()
    try {
      const out = parse(textOf(await mcp.call('search_inventory', { buscar: '6954' })))
      expect(out.articulos[0]).toMatchObject({ codigo: '6954', cantidad: 4, apartado_en_ordenes: 5 })
      const partial = parse(textOf(await mcp.call('search_inventory', { buscar: '69' })))
      expect(partial.articulos[0]).not.toHaveProperty('apartado_en_ordenes')
    } finally {
      await mcp.close()
    }
  })
})
