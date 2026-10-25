/** save_urrea_catalog_item (#155 D) through the real SDK: the description is direct; the rest says what goes stale first. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CallRecord, MockSupabaseClient } from '../helpers/supabase-mock'

const state = vi.hoisted(() => ({ db: null as unknown as MockSupabaseClient }))

vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => state.db), verifierClient: vi.fn() }))

import { createMockSupabase, filterValue } from '../helpers/supabase-mock'
import { connectMcp, textOf } from './harness'
import { TEST_PREVIEW_SECRET } from '../helpers/preview-secret'

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000000${n}`
const ROW = (over: Record<string, unknown> = {}) => ({
  id: ID(1), code: '6954', brand: 'URREA', description: 'Llave combinada', std: 10, created_at: '', updated_at: '2026-10-01T10:00:00Z', ...over,
})
const DECISION = (orderId: string, std: number) => ({ order_id: orderId, std_snapshot: std, orders: { status: 'ordered' } })
const LINE = (orderId: string, brand = '', code = '6954') => ({ order_id: orderId, model_code: code, brand, orders: { status: 'ordered' } })

const parse = (text: string) => JSON.parse(text) as Record<string, unknown>

beforeEach(() => {
  vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
})
afterEach(() => vi.unstubAllEnvs())

interface World {
  rows?: ReturnType<typeof ROW>[]
  decisions?: ReturnType<typeof DECISION>[]
  lines?: ReturnType<typeof LINE>[]
}

function world({ rows = [ROW()], decisions = [], lines = [] }: World = {}) {
  const table = [...rows]
  let clock = 0
  return createMockSupabase({
    responses: {
      'urrea_catalog.select': (rec: CallRecord) => ({ data: table.filter((r) => r.code === filterValue(rec, 'code')), error: null }),
      'urrea_catalog.update': (rec: CallRecord) => {
        const row = table.find((r) => r.id === filterValue(rec, 'id'))
        if (!row) return { data: null, error: { code: 'PGRST116' } }
        Object.assign(row, rec.payload, { updated_at: `2026-10-02T10:00:0${++clock}Z` })
        return { data: row, error: null }
      },
      'urrea_catalog.insert': (rec: CallRecord) => {
        const row = ROW({ id: ID(table.length + 5), ...(rec.payload as object) })
        table.push(row)
        return { data: row, error: null }
      },
      'order_purchase_decisions.select': { data: decisions, error: null },
      'order_items.select': { data: lines, error: null },
    },
  })
}

async function both(args: Record<string, unknown>) {
  const mcp = await connectMcp('admin')
  try {
    const first = await mcp.call('save_urrea_catalog_item', args)
    const key = first.isError ? null : parse(textOf(first)).clave
    // What phase 1 had written when the yes arrived: it must be nothing.
    const afterFirst = state.db._calls.filter((c) => c.op !== 'select').length
    const second = key ? await mcp.call('save_urrea_catalog_item', { ...args, clave: key }) : null
    return { first, second, afterFirst }
  } finally {
    await mcp.close()
  }
}

async function call(args: Record<string, unknown>) {
  const mcp = await connectMcp('admin')
  try {
    return await mcp.call('save_urrea_catalog_item', args)
  } finally {
    await mcp.close()
  }
}

const updates = (db: MockSupabaseClient) => db.callsTo('urrea_catalog', 'update')
const inserts = (db: MockSupabaseClient) => db.callsTo('urrea_catalog', 'insert')

describe('save_urrea_catalog_item: solo la descripción es directa', () => {
  test('escribe en una llamada, sin clave, y dice antes → ahora; la marca default es URREA', async () => {
    state.db = world()
    const result = await call({ codigo: ' 6954 ', descripcion: 'Llave combinada 1/2' })
    expect(result.isError, textOf(result)).toBeFalsy()
    expect(parse(textOf(result))).toMatchObject({
      accion: 'actualizado',
      escrito: true,
      cambios: { descripcion: { antes: 'Llave combinada', ahora: 'Llave combinada 1/2' } },
      articulo: { codigo: '6954', marca: 'URREA', std: 10 },
    })
    expect(updates(state.db).map((c) => c.payload)).toEqual([{ description: 'Llave combinada 1/2' }])
  })

  test('texto vacío borra la descripción (null)', async () => {
    state.db = world()
    await call({ codigo: '6954', descripcion: '  ' })
    expect(updates(state.db)[0].payload).toEqual({ description: null })
  })
})

describe('save_urrea_catalog_item: std, identidad y alta piden el sí y avisan lo que se desactualiza', () => {
  test('std: cuenta las decisiones guardadas con otro std en órdenes en curso; con la clave escribe', async () => {
    state.db = world({ decisions: [DECISION(ID(7), 10), DECISION(ID(8), 10), DECISION(ID(9), 12)] })
    const { first, second, afterFirst } = await both({ codigo: '6954', std: 12 })
    const one = parse(textOf(first))
    expect(afterFirst).toBe(0)
    expect(one).toMatchObject({ accion: 'simulado', escrito: false, cambios: { std: { antes: 10, ahora: 12 } } })
    // The one already decided with 12 is not stale.
    expect(one.avisos).toEqual([expect.stringMatching(/^2 decisiones de compra guardadas quedan desactualizadas \(2 órdenes en curso\) por el cambio de std \(10 → 12\)/)])
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(updates(state.db).map((c) => c.payload)).toEqual([{ std: 12 }])
  })

  test('std sin decisiones que dependan de él lo dice', async () => {
    state.db = world()
    const { first } = await both({ codigo: '6954', std: 6 })
    expect(parse(textOf(first)).avisos).toEqual(['Ninguna decisión de compra guardada depende del std 10.'])
  })

  test('REGLA: el std tiene que ser entero mayor que 0', async () => {
    state.db = world()
    for (const std of [2.5, 0, -3]) expect((await call({ codigo: '6954', std })).isError, String(std)).toBe(true)
    expect(updates(state.db)).toEqual([])
  })

  test('identidad: equivale a baja + alta y todas las decisiones de la clave vieja quedan desactualizadas', async () => {
    state.db = world({ decisions: [DECISION(ID(7), 10)] })
    const { first, second } = await both({ codigo: '6954', nuevo_codigo: '6954-a' })
    const one = parse(textOf(first))
    expect(one.cambios).toEqual({ codigo: { antes: '6954', ahora: '6954-A' } })
    expect(one.avisos).toEqual([expect.stringMatching(/baja \+ alta|quitar la fila vieja/), expect.stringMatching(/1 decisión de compra guardada queda desactualizada/)])
    expect(second?.isError).toBeFalsy()
    expect(updates(state.db).map((c) => c.payload)).toEqual([{ code: '6954-A' }])
  })

  test('una identidad que ya existe es error y no escribe', async () => {
    state.db = world({ rows: [ROW(), ROW({ id: ID(2), code: '6954', brand: 'SURTEK' })] })
    const result = await call({ codigo: '6954', marca: 'urrea', nueva_marca: 'surtek' })
    expect(textOf(result)).toBe('Ya existe el 6954 de SURTEK en el catálogo.')
    expect(updates(state.db)).toEqual([])
  })

  test('alta: avisa que el código pasa de compra local a URREA y cuántas líneas se mueven; con la clave inserta normalizado', async () => {
    // Two SURTEK lines of one order match; the one with no brand is URREA by catalogKey and does not.
    state.db = world({ rows: [], lines: [LINE(ID(7), 'SURTEK', 'SK-120'), LINE(ID(7), 'surtek', 'sk-120'), LINE(ID(8), '', 'SK-120')] })
    const { first, second, afterFirst } = await both({ codigo: 'sk-120', marca: 'surtek', crear: true, std: 6, descripcion: 'Dado 1/2' })
    const one = parse(textOf(first))
    expect(afterFirst).toBe(0)
    expect(one).toMatchObject({ accion: 'simulado', escrito: false, articulo: { codigo: 'SK-120', marca: 'SURTEK', std: 6 } })
    expect(one.avisos).toEqual([expect.stringMatching(/va a URREA en el planificador/), '2 líneas de 1 orden en curso con algo por pedir pasan de compra local a URREA.'])
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(parse(textOf(second!))).toMatchObject({ accion: 'creado', escrito: true })
    expect(inserts(state.db)[0].payload).toEqual({ code: 'SK-120', brand: 'SURTEK', description: 'Dado 1/2', std: 6 })
  })

  test('alta: las líneas en curso con esa clave pasan de local a URREA y se cuentan por catalogKey (marca vacía = URREA)', async () => {
    state.db = world({ rows: [], lines: [LINE(ID(7)), LINE(ID(7), 'urrea'), LINE(ID(8), 'SURTEK')] })
    const { first } = await both({ codigo: '6954', crear: true })
    expect(parse(textOf(first)).avisos).toEqual([expect.stringMatching(/va a URREA/), '2 líneas de 1 orden en curso con algo por pedir pasan de compra local a URREA.'])
  })

  test('alta de un código que existe bajo otra marca avisa que son filas distintas', async () => {
    state.db = world({ rows: [ROW({ brand: 'SURTEK' })] })
    const { first } = await both({ codigo: '6954', marca: 'URREA', crear: true })
    expect(parse(textOf(first)).avisos).toContain('El código ya existe bajo otra marca (SURTEK): son filas distintas.')
  })

  test('la fase 1 sola nunca escribe', async () => {
    state.db = world()
    await call({ codigo: '6954', std: 12 })
    await call({ codigo: '6954', std: 12 })
    expect(updates(state.db)).toEqual([])
  })

  test('REGLA: repetir la clave después de escribir no escribe otra vez (la huella cambió con la escritura)', async () => {
    state.db = world()
    const mcp = await connectMcp('admin')
    try {
      const first = parse(textOf(await mcp.call('save_urrea_catalog_item', { codigo: '6954', std: 12 })))
      await mcp.call('save_urrea_catalog_item', { codigo: '6954', std: 12, clave: first.clave })
      const again = await mcp.call('save_urrea_catalog_item', { codigo: '6954', std: 12, clave: first.clave })
      expect(parse(textOf(again))).toMatchObject({ accion: 'sin_cambios', escrito: false })
    } finally {
      await mcp.close()
    }
    expect(updates(state.db)).toHaveLength(1)
  })

  test('la huella: si cambió el std entre el resumen y el sí, no escribe', async () => {
    state.db = world()
    const mcp = await connectMcp('admin')
    let after: MockSupabaseClient
    try {
      const first = parse(textOf(await mcp.call('save_urrea_catalog_item', { codigo: '6954', std: 12 })))
      after = state.db = world({ rows: [ROW({ std: 8, updated_at: '2026-10-03T10:00:00Z' })] })
      const second = await mcp.call('save_urrea_catalog_item', { codigo: '6954', std: 12, clave: first.clave })
      expect(textOf(second)).toBe('El 6954 de URREA cambió desde el resumen: vuelve a pedirlo. No escribí nada.')
    } finally {
      await mcp.close()
    }
    expect(updates(after)).toEqual([])
  })
})

describe('save_urrea_catalog_item: búsquedas y errores', () => {
  test('un código en varias marcas sin `marca` lista las marcas; con `marca` elige', async () => {
    state.db = world({ rows: [ROW(), ROW({ id: ID(2), brand: 'SURTEK' })] })
    expect(textOf(await call({ codigo: '6954', descripcion: 'x' }))).toBe('El código 6954 existe en 2 marcas (URREA, SURTEK): indica `marca`.')
    expect(parse(textOf(await call({ codigo: '6954', marca: 'surtek', descripcion: 'x' }))).articulo).toMatchObject({ marca: 'SURTEK' })
  })

  test('un código desconocido explica cómo darlo de alta; crear uno que existe, también', async () => {
    state.db = world()
    expect(textOf(await call({ codigo: '9999', std: 2 }))).toMatch(/crear: true/)
    expect(textOf(await call({ codigo: '6954', crear: true }))).toMatch(/Ya existe el 6954 de URREA/)
    expect(textOf(await call({ codigo: '9999', crear: true, nuevo_codigo: 'X' }))).toMatch(/nuevo_codigo/)
  })

  test('nada que cambiar, o lo que ya vale eso: error o sin_cambios, sin escribir', async () => {
    state.db = world()
    expect((await call({ codigo: '6954' })).isError).toBe(true)
    expect(parse(textOf(await call({ codigo: '6954', std: 10, descripcion: 'Llave combinada' }))).accion).toBe('sin_cambios')
    expect(updates(state.db)).toEqual([])
  })

  test('sin MCP_PREVIEW_SECRET la descripción sigue directa y el std falla cerrado; un member ni la recibe', async () => {
    state.db = world()
    vi.stubEnv('MCP_PREVIEW_SECRET', '')
    expect(parse(textOf(await call({ codigo: '6954', descripcion: 'Otra' }))).accion).toBe('actualizado')
    const closed = await call({ codigo: '6954', std: 12 })
    expect(closed.isError).toBe(true)
    expect(textOf(closed)).toMatch(/todavía no está activada/)
    const member = await connectMcp('member')
    try {
      expect((await member.tools()).map((t) => t.name)).not.toContain('save_urrea_catalog_item')
    } finally {
      await member.close()
    }
    expect(updates(state.db)).toHaveLength(1)
  })
})
