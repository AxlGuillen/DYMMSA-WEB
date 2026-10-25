/** save_purchase_decisions (#155 D) through the real SDK: only the choice travels, the server builds the complete set. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CallRecord, MockSupabaseClient } from '../helpers/supabase-mock'

const state = vi.hoisted(() => ({ db: null as unknown as MockSupabaseClient }))

vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => state.db), verifierClient: vi.fn() }))

import { createMockSupabase, filterValue } from '../helpers/supabase-mock'
import { connectMcp, textOf } from './harness'
import { TEST_PREVIEW_SECRET } from '../helpers/preview-secret'

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const parse = (text: string) => JSON.parse(text) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
})
afterEach(() => vi.unstubAllEnvs())

const item = (id: string, code: string, qty: number, price: number, brand = 'URREA') => ({
  id, item_type: 'product', etm: `E-${id}`, model_code: code, brand, description: code, section_label: null, quantity_to_order: qty, unit_price: price,
})
// 6954: 37 of std 10 → rounds up cheaply (wholesale); 4410: 5 of std 12 at $100 → parks $700 (retail); REV1: 2 of std 10 at $5 → 80 % parked, under $100 (revisar).
const ITEMS = [item('a', '6954', 37, 10), item('b', '4410', 5, 100), item('c', 'REV1', 2, 5), item('d', 'LOC9', 3, 8)]
const CATALOG = [
  { code: '6954', brand: 'URREA', description: 'Llave', std: 10 },
  { code: '4410', brand: 'URREA', description: 'Dado', std: 12 },
  { code: 'REV1', brand: 'URREA', description: 'Revisar', std: 10 },
]
const decision = (code: string, over: Record<string, unknown> = {}) => ({
  id: `dec-${code}`, order_id: ORDER_ID, model_code: code, brand: 'URREA', std_snapshot: 10, needed_qty: 37, packages_wholesale: 4, qty_retail: 0, decided_at: '', ...over,
})

function world({ status = 'ordered', items = ITEMS, catalog = CATALOG, decisions = [] as ReturnType<typeof decision>[] } = {}) {
  const saved = [...decisions]
  return createMockSupabase({
    responses: {
      'orders.select': (rec: CallRecord) =>
        rec.filters.some((f) => f.method === 'or') || rec.columns?.includes('customer_name')
          ? { data: [{ id: ORDER_ID, name: 'ORD-12', customer_name: 'GE', status }], error: null }
          : { data: filterValue(rec, 'id') === ORDER_ID ? { id: ORDER_ID, status } : null, error: null },
      'order_items.select': { data: items, error: null },
      'urrea_catalog.select': { data: catalog, error: null },
      'app_settings.select': { data: [], error: null },
      'order_purchase_decisions.select': () => ({ data: saved.map((d) => ({ ...d })), error: null }),
      'order_purchase_decisions.upsert': (rec: CallRecord) => {
        for (const row of rec.payload as Record<string, unknown>[]) {
          const i = saved.findIndex((d) => d.model_code === row.model_code && d.brand === row.brand)
          const next = { id: `dec-${row.model_code}`, ...row } as ReturnType<typeof decision>
          if (i >= 0) saved[i] = next
          else saved.push(next)
        }
        return { data: rec.payload, error: null }
      },
      'order_purchase_decisions.delete': (rec: CallRecord) => {
        const ids = rec.filters.find((f) => f.method === 'in')?.args[1] as string[]
        for (const id of ids) saved.splice(saved.findIndex((d) => d.id === id), 1)
        return { data: null, error: null }
      },
    },
  })
}

async function open() {
  return connectMcp('admin')
}

async function both(args: Record<string, unknown>) {
  const mcp = await open()
  try {
    const first = await mcp.call('save_purchase_decisions', args)
    const key = first.isError ? null : parse(textOf(first)).clave
    const afterFirst = state.db._calls.filter((c) => c.op !== 'select').length
    const second = key ? await mcp.call('save_purchase_decisions', { ...args, clave: key }) : null
    return { first, second, afterFirst }
  } finally {
    await mcp.close()
  }
}

const call = async (args: Record<string, unknown>) => {
  const mcp = await open()
  try {
    return await mcp.call('save_purchase_decisions', args)
  } finally {
    await mcp.close()
  }
}

const upserts = (db: MockSupabaseClient) => db.callsTo('order_purchase_decisions', 'upsert')

describe('save_purchase_decisions', () => {
  test('eval 9: aceptar las recomendaciones y decidir la que está por revisar; la fase 1 muestra cada grupo y el total sin escribir; STD y necesidad salen del plan', async () => {
    state.db = world()
    const { first, second, afterFirst } = await both({ orden: 'ORD-12', aceptar_recomendaciones: true, decisiones: [{ codigo: 'rev1', eleccion: 'mayoreo' }] })
    expect(afterFirst).toBe(0)
    const one = parse(textOf(first))
    expect(one).toMatchObject({ accion: 'simulado', escrito: false })
    expect(one.decisiones.grupos).toEqual([
      { codigo: '6954', marca: 'URREA', necesita: 37, std: 10, eleccion: 'mayoreo', paquetes_mayoreo: 4, piezas_menudeo: 0 },
      { codigo: '4410', marca: 'URREA', necesita: 5, std: 12, eleccion: 'menudeo', paquetes_mayoreo: 0, piezas_menudeo: 5 },
      { codigo: 'REV1', marca: 'URREA', necesita: 2, std: 10, eleccion: 'mayoreo', paquetes_mayoreo: 1, piezas_menudeo: 0 },
    ])
    // 4 + 1 packages go to URREA (50 pieces), 5 retail; wholesale parks 3 + 8 pieces ($30 + $40), the retail 4410 spares $700.
    expect(one.decisiones.total).toEqual({ paquetes_a_urrea: 5, piezas_a_urrea: 50, piezas_a_menudeo: 5, dinero_parado_mxn: 70, dinero_ahorrado_mxn: 700 })
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(upserts(state.db)[0].payload).toEqual([
      expect.objectContaining({ order_id: ORDER_ID, model_code: '6954', brand: 'URREA', std_snapshot: 10, needed_qty: 37, packages_wholesale: 4, qty_retail: 0 }),
      expect.objectContaining({ model_code: '4410', std_snapshot: 12, needed_qty: 5, packages_wholesale: 0, qty_retail: 5 }),
      expect.objectContaining({ model_code: 'REV1', std_snapshot: 10, needed_qty: 2, packages_wholesale: 1, qty_retail: 0 }),
    ])
    expect(parse(textOf(second!))).toMatchObject({ accion: 'actualizado', escrito: true, decisiones: { guardadas: 3 } })
  })

  test('un grupo «revisar» sin decidir es un bloqueo sin clave: pasa al servidor la regla que vivía en la pantalla', async () => {
    state.db = world()
    const { first, second } = await both({ orden: 'ORD-12', aceptar_recomendaciones: true })
    const one = parse(textOf(first))
    expect(one.bloqueos).toEqual([expect.stringContaining('Quedan 1 grupos sin decidir: REV1 (URREA) [revisar]')])
    expect(one).not.toHaveProperty('clave')
    expect(second).toBeNull()
    expect(upserts(state.db)).toEqual([])
  })

  test('sin aceptar recomendaciones, lo que no se menciona ni tiene decisión guardada queda sin decidir', async () => {
    state.db = world()
    const first = parse(textOf(await call({ orden: 'ORD-12', decisiones: [{ codigo: '6954', eleccion: 'mayoreo' }] })))
    expect(first.bloqueos[0]).toMatch(/Quedan 2 grupos sin decidir.*o pide `aceptar_recomendaciones`/)
  })

  test('replace-all: mencionar un grupo conserva las decisiones guardadas de los demás (el set es siempre el completo)', async () => {
    state.db = world({ decisions: [decision('6954'), decision('4410', { std_snapshot: 12, needed_qty: 5, packages_wholesale: 0, qty_retail: 5 }), decision('REV1', { needed_qty: 2, packages_wholesale: 1 })] })
    const { first, second } = await both({ orden: 'ORD-12', decisiones: [{ codigo: '6954', eleccion: 'mixto' }] })
    const one = parse(textOf(first))
    expect(Object.keys(one.cambios)).toEqual(['6954 (URREA)'])
    expect(one.cambios['6954 (URREA)']).toEqual({
      antes: { eleccion: 'mayoreo', paquetes_mayoreo: 4, piezas_menudeo: 0 },
      ahora: { eleccion: 'mixto', paquetes_mayoreo: 3, piezas_menudeo: 7 },
    })
    expect(one.avisos).toContain('2 grupos se quedan como está guardado.')
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect((upserts(state.db)[0].payload as unknown[]).length).toBe(3)
  })

  test('una decisión desactualizada se reaplica sobre la matemática de hoy y lo dice', async () => {
    state.db = world({ decisions: [decision('6954', { needed_qty: 30, packages_wholesale: 3 }), decision('4410', { std_snapshot: 12, needed_qty: 5, packages_wholesale: 0, qty_retail: 5 }), decision('REV1', { needed_qty: 2, packages_wholesale: 1 })] })
    const first = parse(textOf(await call({ orden: 'ORD-12', decisiones: [{ codigo: '4410', eleccion: 'menudeo' }] })))
    expect(first.cambios['6954 (URREA)'].antes).toMatchObject({ eleccion: 'mayoreo', paquetes_mayoreo: 3, desactualizada: true })
    expect(first.cambios['6954 (URREA)'].ahora).toMatchObject({ eleccion: 'mayoreo', paquetes_mayoreo: 4 })
  })

  test('las decisiones huérfanas se limpian y se avisa; con todo igual y sin huérfanas es sin_cambios', async () => {
    const all = [decision('6954'), decision('4410', { std_snapshot: 12, needed_qty: 5, packages_wholesale: 0, qty_retail: 5 }), decision('REV1', { needed_qty: 2, packages_wholesale: 1 })]
    state.db = world({ decisions: [...all, decision('OLD', { id: 'orphan-1' })] })
    const { first, second } = await both({ orden: 'ORD-12', aceptar_recomendaciones: true })
    expect(parse(textOf(first)).avisos).toContain('Se limpian 1 decisiones huérfanas (de grupos que ya no están en la orden).')
    expect(second?.isError).toBeFalsy()
    expect(state.db.callsTo('order_purchase_decisions', 'delete')).toHaveLength(1)

    state.db = world({ decisions: all })
    expect(parse(textOf(await call({ orden: 'ORD-12', aceptar_recomendaciones: true }))).accion).toBe('sin_cambios')
  })

  test('REGLA: repetir la clave después de guardar no escribe otra vez', async () => {
    state.db = world()
    const mcp = await open()
    try {
      const args = { orden: 'ORD-12', aceptar_recomendaciones: true, decisiones: [{ codigo: 'REV1', eleccion: 'menudeo' }] }
      const key = parse(textOf(await mcp.call('save_purchase_decisions', args))).clave
      await mcp.call('save_purchase_decisions', { ...args, clave: key })
      const again = await mcp.call('save_purchase_decisions', { ...args, clave: key })
      expect(parse(textOf(again))).toMatchObject({ accion: 'sin_cambios', escrito: false })
    } finally {
      await mcp.close()
    }
    expect(upserts(state.db)).toHaveLength(1)
  })

  test('la huella: si la necesidad de la orden cambió entre el resumen y el sí, no escribe', async () => {
    state.db = world()
    const mcp = await open()
    let after: MockSupabaseClient
    try {
      const args = { orden: 'ORD-12', aceptar_recomendaciones: true, decisiones: [{ codigo: 'REV1', eleccion: 'mayoreo' }] }
      const first = parse(textOf(await mcp.call('save_purchase_decisions', args)))
      after = state.db = world({ items: [item('a', '6954', 45, 10), ...ITEMS.slice(1)] })
      const second = await mcp.call('save_purchase_decisions', { ...args, clave: first.clave })
      expect(textOf(second)).toBe('Las decisiones de compra de ORD-12 cambió desde el resumen: vuelve a pedirlo. No escribí nada.')
    } finally {
      await mcp.close()
    }
    expect(upserts(after)).toEqual([])
  })

  test('errores: código en compra local, código que la orden no trae, marca ambigua, código repetido, elección inválida, nada que hacer', async () => {
    state.db = world({ catalog: [...CATALOG, { code: '6954', brand: 'SURTEK', description: 'Llave S', std: 6 }], items: [...ITEMS, item('e', '6954', 4, 10, 'SURTEK')] })
    expect(textOf(await call({ orden: 'ORD-12', decisiones: [{ codigo: 'LOC9', eleccion: 'menudeo' }] }))).toMatch(/va a compra local/)
    expect(textOf(await call({ orden: 'ORD-12', decisiones: [{ codigo: 'ZZZ', eleccion: 'menudeo' }] }))).toMatch(/La orden no trae ZZZ\. Los grupos con decisión son: /)
    expect(textOf(await call({ orden: 'ORD-12', decisiones: [{ codigo: '6954', eleccion: 'menudeo' }] }))).toBe('El código 6954 está en varias marcas (URREA, SURTEK): indica `marca`.')
    expect(textOf(await call({ orden: 'ORD-12', decisiones: [{ codigo: '4410', eleccion: 'menudeo' }, { codigo: '4410', eleccion: 'mayoreo' }] }))).toMatch(/viene dos veces/)
    expect((await call({ orden: 'ORD-12', decisiones: [{ codigo: '4410', eleccion: 'regalar' }] })).isError).toBe(true)
    expect(textOf(await call({ orden: 'ORD-12' }))).toMatch(/Indica `decisiones`/)
    expect(upserts(state.db)).toEqual([])
  })

  test('una orden completada o cancelada no se modifica; una sin grupos del catálogo no tiene qué decidir', async () => {
    state.db = world({ status: 'completed' })
    expect((await call({ orden: 'ORD-12', aceptar_recomendaciones: true })).isError).toBe(true)
    state.db = world({ catalog: [] })
    expect(textOf(await call({ orden: 'ORD-12', aceptar_recomendaciones: true }))).toMatch(/no tiene grupos del catálogo URREA que decidir/)
  })

  test('sin MCP_PREVIEW_SECRET falla cerrado; un member ni la recibe', async () => {
    state.db = world()
    vi.stubEnv('MCP_PREVIEW_SECRET', '')
    expect(textOf(await call({ orden: 'ORD-12', aceptar_recomendaciones: true }))).toMatch(/todavía no está activada/)
    const member = await connectMcp('member')
    try {
      expect((await member.tools()).map((t) => t.name)).not.toContain('save_purchase_decisions')
    } finally {
      await member.close()
    }
    expect(upserts(state.db)).toEqual([])
  })
})
