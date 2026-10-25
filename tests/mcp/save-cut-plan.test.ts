/** save_cut_plan (#155 D) through the real SDK: adding is direct; removing and replacing say how the net need moves first. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CallRecord, MockSupabaseClient } from '../helpers/supabase-mock'

const state = vi.hoisted(() => ({ db: null as unknown as MockSupabaseClient }))

vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => state.db), verifierClient: vi.fn() }))

import { createMockSupabase, filterValue } from '../helpers/supabase-mock'
import { connectMcp, textOf } from './harness'
import { TEST_PREVIEW_SECRET } from '../helpers/preview-secret'

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const parse = (text: string) => JSON.parse(text) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
})
afterEach(() => vi.unstubAllEnvs())

// numeric columns come back from supabase-js as strings: the tool coerces them at its boundary.
const tube = (n: number, over: Record<string, unknown> = {}) => ({
  id: `piece-${n}`, order_id: ORDER_ID, material_type: 'tube', diameter_mm: '25.4', thickness_mm: null, width_mm: null, length_mm: '300', quantity: 4,
  requested_label: null, source_item_id: null, sort_order: n - 1, created_at: '', updated_at: '', ...over,
})
const plate = (n: number, over: Record<string, unknown> = {}) => ({
  id: `piece-${n}`, order_id: ORDER_ID, material_type: 'plate', diameter_mm: null, thickness_mm: '6', width_mm: '200', length_mm: '400', quantity: 2,
  requested_label: 'placa 6 mm', source_item_id: ITEM_ID, sort_order: n - 1, created_at: '', updated_at: '', ...over,
})

function world({ status = 'ordered', pieces = [tube(1), plate(2), tube(3, { diameter_mm: '12.7', length_mm: '500', quantity: 1 })] as Record<string, unknown>[], insertError = false } = {}) {
  let list = [...pieces]
  return createMockSupabase({
    responses: {
      'orders.select': (rec: CallRecord) =>
        rec.filters.some((f) => f.method === 'or')
          ? { data: [{ id: ORDER_ID, name: 'ORD-12', customer_name: 'GE', status }], error: null }
          : { data: filterValue(rec, 'id') === ORDER_ID ? { id: ORDER_ID, status } : null, error: null },
      'app_settings.select': { data: [], error: null },
      'cut_plan_pieces.select': () => ({ data: list.map((p) => ({ ...p })), error: null }),
      'cut_plan_pieces.delete': () => {
        list = []
        return { data: null, error: null }
      },
      'cut_plan_pieces.insert': (rec: CallRecord) => {
        const rows = rec.payload as Record<string, unknown>[]
        if (insertError && rows.length > 0 && list.length === 0 && rows.some((r) => r.order_id)) {
          insertError = false
          return { data: null, error: { code: '23514', message: 'cut_piece_shape' } }
        }
        list = rows.map((r, i) => ({ id: `new-${i + 1}`, ...r }))
        return { data: list, error: null }
      },
      'order_items.select': { data: [{ id: ITEM_ID }], error: null },
    },
  })
}

async function open() {
  return connectMcp('admin')
}

async function both(args: Record<string, unknown>) {
  const mcp = await open()
  try {
    const first = await mcp.call('save_cut_plan', args)
    const key = first.isError ? null : parse(textOf(first)).clave
    const afterFirst = state.db._calls.filter((c) => c.op !== 'select').length
    const second = key ? await mcp.call('save_cut_plan', { ...args, clave: key }) : null
    return { first, second, afterFirst }
  } finally {
    await mcp.close()
  }
}

const call = async (args: Record<string, unknown>) => {
  const mcp = await open()
  try {
    return await mcp.call('save_cut_plan', args)
  } finally {
    await mcp.close()
  }
}

const inserts = (db: MockSupabaseClient) => db.callsTo('cut_plan_pieces', 'insert')

describe('save_cut_plan: agregar es directo', () => {
  test('eval 10: agrega 4 tubos de 25.4 × 300 sin pedir clave; manda la lista completa (las existentes primero, con su origen y etiqueta)', async () => {
    state.db = world()
    const result = await call({ orden: 'ORD-12', accion: 'agregar', piezas: [{ tipo: 'tubo', diametro_mm: 25.4, largo_mm: 300, cantidad: 4, pedido_como: '1 pulgada' }] })
    expect(result.isError, textOf(result)).toBeFalsy()
    const out = parse(textOf(result))
    expect(out).toMatchObject({ accion: 'actualizado', escrito: true, lista_de_corte: { guardadas: 4 } })
    expect(out).not.toHaveProperty('clave')
    expect(out.cambios.piezas).toEqual({ antes: 3, ahora: 4 })
    const rows = inserts(state.db)[0].payload as Record<string, unknown>[]
    expect(rows.map((r) => [r.sort_order, r.material_type, r.diameter_mm ?? r.thickness_mm, r.length_mm, r.quantity])).toEqual([
      [0, 'tube', 25.4, 300, 4],
      [1, 'plate', 6, 400, 2],
      [2, 'tube', 12.7, 500, 1],
      [3, 'tube', 25.4, 300, 4],
    ])
    expect(rows[1]).toMatchObject({ requested_label: 'placa 6 mm', source_item_id: ITEM_ID, order_id: ORDER_ID })
    expect(rows[3]).toMatchObject({ requested_label: '1 pulgada', source_item_id: null })
  })

  test('la necesidad neta de lo agregado va en cambios (largo + margen de 20 mm por corte)', async () => {
    state.db = world({ pieces: [] })
    const out = parse(textOf(await call({ orden: 'ORD-12', accion: 'agregar', piezas: [{ tipo: 'tubo', diametro_mm: 25.4, largo_mm: 300, cantidad: 4 }] })))
    expect(out.cambios['necesidad tubo 25.4 mm']).toEqual({ antes: null, ahora: { unidades: 4, largo_neto_mm: 1280 } })
    expect(out.avisos).toContain('Necesidad neta con margen de 20 mm por corte.')
  })

  test('las reglas de la ruta corren antes de escribir: un tubo no lleva ancho, una placa necesita espesor y ancho', async () => {
    state.db = world()
    expect(textOf(await call({ orden: 'ORD-12', accion: 'agregar', piezas: [{ tipo: 'tubo', diametro_mm: 25.4, ancho_mm: 10, largo_mm: 300, cantidad: 1 }] }))).toBe('Pieza 4: un tubo no lleva ancho ni espesor')
    expect(textOf(await call({ orden: 'ORD-12', accion: 'agregar', piezas: [{ tipo: 'placa', espesor_mm: 6, largo_mm: 300, cantidad: 1 }] }))).toBe('Pieza 4: una placa necesita espesor y ancho')
    expect((await call({ orden: 'ORD-12', accion: 'agregar', piezas: [{ tipo: 'tubo', diametro_mm: 25.4, largo_mm: 300, cantidad: 0 }] })).isError).toBe(true)
    expect(inserts(state.db)).toEqual([])
  })
})

describe('save_cut_plan: quitar y reemplazar piden el sí', () => {
  test('quitar por número de get_cut_plan: la fase 1 dice qué sale y cómo baja la necesidad, sin escribir; con la clave reinserta el resto en orden', async () => {
    state.db = world()
    const { first, second, afterFirst } = await both({ orden: 'ORD-12', accion: 'quitar', quitar_piezas: [2] })
    expect(afterFirst).toBe(0)
    const one = parse(textOf(first))
    expect(one).toMatchObject({ accion: 'simulado', escrito: false })
    expect(one.avisos[0]).toMatch(/^Sale la pieza 2: placa de 6 mm \(ancho 200 mm\) × 400 mm × 2\./)
    expect(one.cambios['necesidad placa 6 mm']).toMatchObject({ antes: { unidades: 2 }, ahora: null })
    expect(one.cambios.piezas).toEqual({ antes: 3, ahora: 2 })
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect((inserts(state.db)[0].payload as Record<string, unknown>[]).map((r) => [r.sort_order, r.material_type])).toEqual([[0, 'tube'], [1, 'tube']])
  })

  test('reemplazar cambia toda la lista; reemplazar con una lista vacía la vacía y lo dice', async () => {
    state.db = world()
    const { first, second } = await both({ orden: 'ORD-12', accion: 'reemplazar', piezas: [{ tipo: 'placa', espesor_mm: 3, ancho_mm: 100, largo_mm: 200, cantidad: 5 }] })
    expect(parse(textOf(first)).avisos[0]).toBe('Reemplaza la lista completa: salen 3 piezas y entran 1.')
    expect(second?.isError).toBeFalsy()
    expect(inserts(state.db)[0].payload).toHaveLength(1)

    state.db = world()
    const empty = await both({ orden: 'ORD-12', accion: 'reemplazar', piezas: [] })
    expect(parse(textOf(empty.first)).avisos[0]).toBe('Reemplaza la lista completa: salen 3 piezas y la lista queda vacía.')
    expect(empty.second?.isError).toBeFalsy()
    expect(inserts(state.db)).toEqual([])
    expect(state.db.callsTo('cut_plan_pieces', 'delete')).toHaveLength(1)
  })

  test('una lista idéntica al reemplazar es sin_cambios', async () => {
    state.db = world({ pieces: [tube(1)] })
    const same = await call({ orden: 'ORD-12', accion: 'reemplazar', piezas: [{ tipo: 'tubo', diametro_mm: 25.4, largo_mm: 300, cantidad: 4 }] })
    expect(parse(textOf(same))).toMatchObject({ accion: 'sin_cambios', escrito: false })
  })

  test('la huella: si otra persona cambió la lista entre el resumen y el sí, no escribe', async () => {
    state.db = world()
    const mcp = await open()
    let after: MockSupabaseClient
    try {
      const args = { orden: 'ORD-12', accion: 'quitar', quitar_piezas: [1] }
      const first = parse(textOf(await mcp.call('save_cut_plan', args)))
      after = state.db = world({ pieces: [tube(1), plate(2)] })
      const second = await mcp.call('save_cut_plan', { ...args, clave: first.clave })
      expect(textOf(second)).toBe('La lista de corte de ORD-12 cambió desde el resumen: vuelve a pedirlo. No escribí nada.')
    } finally {
      await mcp.close()
    }
    expect(inserts(after)).toEqual([])
  })

  test('REGLA: repetir la clave después de quitar no vuelve a quitar (los ids cambian al reinsertar)', async () => {
    state.db = world()
    const mcp = await open()
    try {
      const args = { orden: 'ORD-12', accion: 'quitar', quitar_piezas: [3] }
      const key = parse(textOf(await mcp.call('save_cut_plan', args))).clave
      await mcp.call('save_cut_plan', { ...args, clave: key })
      const again = await mcp.call('save_cut_plan', { ...args, clave: key })
      expect(again.isError).toBe(true)
    } finally {
      await mcp.close()
    }
    expect(state.db.callsTo('cut_plan_pieces', 'delete')).toHaveLength(1)
  })

  test('si el insert falla, la lista anterior se restaura (la regla del store) y el error explica la regla rota', async () => {
    state.db = world({ insertError: true })
    const { second } = await both({ orden: 'ORD-12', accion: 'quitar', quitar_piezas: [3] })
    expect(second?.isError).toBe(true)
    const writes = inserts(state.db)
    // First the failed insert, then the snapshot goes back without ids.
    expect(writes).toHaveLength(2)
    expect((writes[1].payload as Record<string, unknown>[]).every((row) => !('id' in row))).toBe(true)
  })
})

describe('save_cut_plan: errores y permisos', () => {
  test('quitar sin números, números fuera de la lista, mezclar acciones y agregar sin piezas', async () => {
    state.db = world()
    expect(textOf(await call({ orden: 'ORD-12', accion: 'quitar' }))).toMatch(/indica `quitar_piezas`/)
    expect(textOf(await call({ orden: 'ORD-12', accion: 'quitar', quitar_piezas: [9] }))).toBe('No hay pieza 9: la lista tiene 3.')
    expect(textOf(await call({ orden: 'ORD-12', accion: 'quitar', quitar_piezas: [1], piezas: [{ tipo: 'tubo', diametro_mm: 1, largo_mm: 1, cantidad: 1 }] }))).toMatch(/quitar y agregar son dos llamadas/)
    expect(textOf(await call({ orden: 'ORD-12', accion: 'agregar' }))).toBe('Para agregar indica `piezas`.')
    expect(textOf(await call({ orden: 'ORD-12', accion: 'agregar', quitar_piezas: [1], piezas: [{ tipo: 'tubo', diametro_mm: 1, largo_mm: 1, cantidad: 1 }] }))).toMatch(/agregar y quitar son dos llamadas/)
    expect(inserts(state.db)).toEqual([])
  })

  test('una orden completada o cancelada no se modifica', async () => {
    state.db = world({ status: 'cancelled' })
    expect(textOf(await call({ orden: 'ORD-12', accion: 'agregar', piezas: [{ tipo: 'tubo', diametro_mm: 1, largo_mm: 1, cantidad: 1 }] }))).toBe('Una orden completada o cancelada no se modifica.')
  })

  test('sin MCP_PREVIEW_SECRET agregar sigue directo y quitar falla cerrado; un member ni la recibe', async () => {
    state.db = world()
    vi.stubEnv('MCP_PREVIEW_SECRET', '')
    expect(parse(textOf(await call({ orden: 'ORD-12', accion: 'agregar', piezas: [{ tipo: 'tubo', diametro_mm: 25.4, largo_mm: 300, cantidad: 1 }] }))).accion).toBe('actualizado')
    expect(textOf(await call({ orden: 'ORD-12', accion: 'quitar', quitar_piezas: [1] }))).toMatch(/todavía no está activada/)
    const member = await connectMcp('member')
    try {
      expect((await member.tools()).map((t) => t.name)).not.toContain('save_cut_plan')
    } finally {
      await member.close()
    }
  })
})
