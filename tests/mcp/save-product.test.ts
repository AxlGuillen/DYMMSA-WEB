/** save_product (#155 D) through the real SDK: low-risk edits write directly, the catalog cross asks for the yes. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CallRecord, MockSupabaseClient } from '../helpers/supabase-mock'

const state = vi.hoisted(() => ({ db: null as unknown as MockSupabaseClient }))

vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => state.db), verifierClient: vi.fn() }))

import { createMockSupabase, filterValue } from '../helpers/supabase-mock'
import { connectMcp, textOf } from './harness'
import { TEST_PREVIEW_SECRET } from '../helpers/preview-secret'

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000000${n}`
const PRODUCT = (over: Record<string, unknown> = {}) => ({
  id: ID(1), etm: '1180234', description: 'Rodillo', description_es: 'Rodillo 9 pulgadas', dymmsa_description: null, model_code: '6954', price: 100,
  brand: 'URREA', is_sold: null, created_at: '', updated_at: '2026-10-01T10:00:00Z', created_by: null, ...over,
})

const parse = (text: string) => JSON.parse(text) as Record<string, unknown>

beforeEach(() => {
  vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
})
afterEach(() => vi.unstubAllEnvs())

/** etm_products as PostgREST answers it for the lookups of the tool; an update bumps updated_at, as the trigger does. */
function table(initial: ReturnType<typeof PRODUCT>[] = [PRODUCT()], catalog: { code: string; brand: string; description: string }[] = []) {
  const rows = [...initial]
  let clock = 0
  return createMockSupabase({
    responses: {
      'etm_products.select': (rec: CallRecord) => {
        const ilike = rec.filters.find((f) => f.method === 'ilike')
        if (ilike) return { data: rows.filter((r) => r.etm.toLowerCase() === String(ilike.args[1]).toLowerCase()), error: null }
        if (rec.filters.some((f) => f.method === 'like')) return { data: rows.map((r) => ({ etm: r.etm })), error: null }
        const id = filterValue(rec, 'id')
        if (id) return { data: rows.find((r) => r.id === id) ?? null, error: null }
        return { data: rows, error: null }
      },
      'etm_products.update': (rec: CallRecord) => {
        const row = rows.find((r) => r.id === filterValue(rec, 'id'))
        if (!row) return { data: null, error: { code: 'PGRST116' } }
        Object.assign(row, rec.payload, { updated_at: `2026-10-02T10:00:0${++clock}Z` })
        return { data: row, error: null }
      },
      'etm_products.insert': (rec: CallRecord) => {
        const row = PRODUCT({ id: ID(rows.length + 5), ...(rec.payload as object) })
        if (rows.some((r) => r.etm === row.etm)) return { data: null, error: { code: '23505' } }
        rows.push(row)
        return { data: row, error: null }
      },
      'urrea_catalog.select': { data: catalog, error: null },
    },
  })
}

async function call(args: Record<string, unknown>, role: 'admin' | 'member' = 'admin') {
  const mcp = await connectMcp(role)
  try {
    return await mcp.call('save_product', args)
  } finally {
    await mcp.close()
  }
}

async function both(args: Record<string, unknown>) {
  const mcp = await connectMcp('admin')
  try {
    const first = await mcp.call('save_product', args)
    const key = first.isError ? null : parse(textOf(first)).clave
    const second = key ? await mcp.call('save_product', { ...args, clave: key }) : null
    return { first, second }
  } finally {
    await mcp.close()
  }
}

const updates = (db: MockSupabaseClient) => db.callsTo('etm_products', 'update')
const inserts = (db: MockSupabaseClient) => db.callsTo('etm_products', 'insert')

describe('save_product: edición directa', () => {
  test('el precio escribe en una llamada y dice antes → ahora', async () => {
    state.db = table()
    const result = await call({ etm: '1180234', precio: 245.5 })
    expect(result.isError, textOf(result)).toBeFalsy()
    expect(parse(textOf(result))).toMatchObject({ accion: 'actualizado', escrito: true, cambios: { precio: { antes: 100, ahora: 245.5 } }, producto: { etm: '1180234', precio: 245.5 } })
    expect(updates(state.db).map((c) => c.payload)).toEqual([{ price: 245.5 }])
  })

  test('el ETM se encuentra sin distinguir mayúsculas y por ref', async () => {
    state.db = table([PRODUCT({ etm: 'ABC-1' })])
    expect(parse(textOf(await call({ etm: 'abc-1', precio: 1 }))).accion).toBe('actualizado')
    expect(parse(textOf(await call({ etm: ID(1).slice(0, 8), precio: 2 }))).accion).toBe('actualizado')
  })

  test('se_vende es tri-estado: «no» escribe false y «sin_definir» escribe null explícito', async () => {
    state.db = table()
    await call({ etm: '1180234', se_vende: 'no' })
    expect(updates(state.db)[0].payload).toEqual({ is_sold: false })
    await call({ etm: '1180234', se_vende: 'sin_definir' })
    expect(updates(state.db)[1].payload).toEqual({ is_sold: null })
  })

  test('REGLA ADR-013: la descripción oficial del catálogo no se copia como curada', async () => {
    state.db = table([PRODUCT()], [{ code: '6954', brand: 'URREA', description: 'Oficial' }])
    const result = await call({ etm: '1180234', descripcion_dymmsa: 'Mi texto' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/descripción oficial en el catálogo URREA/)
    expect(updates(state.db)).toEqual([])
  })

  test('sin catálogo para ese código la curada sí se guarda y el vacío la borra', async () => {
    state.db = table([PRODUCT({ dymmsa_description: 'Vieja' })])
    await call({ etm: '1180234', descripcion_dymmsa: '' })
    expect(updates(state.db)[0].payload).toEqual({ dymmsa_description: null })
  })

  test('lo que ya vale eso no es un cambio: sin_cambios, sin escribir', async () => {
    state.db = table()
    const result = parse(textOf(await call({ etm: '1180234', precio: 100, se_vende: 'sin_definir' })))
    expect(result).toMatchObject({ accion: 'sin_cambios', escrito: false })
    expect(updates(state.db)).toEqual([])
  })

  test('un precio negativo, nada que cambiar y un campo desconocido son errores que no escriben', async () => {
    state.db = table()
    for (const args of [{ etm: '1180234', precio: -1 }, { etm: '1180234' }, { etm: '1180234', cantidad: 3 }]) {
      const result = await call(args)
      expect(result.isError, JSON.stringify(args)).toBe(true)
    }
    expect(updates(state.db)).toEqual([])
  })

  test('un ETM desconocido explica cómo darlo de alta; dos ETM que difieren solo en mayúsculas piden precisar', async () => {
    state.db = table()
    const missing = await call({ etm: 'NOEXISTE', precio: 1 })
    expect(textOf(missing)).toMatch(/crear: true/)
    state.db = table([PRODUCT({ etm: 'AB' }), PRODUCT({ id: ID(2), etm: 'ab' })])
    const ambiguous = await call({ etm: 'Ab', precio: 1 })
    expect(textOf(ambiguous)).toMatch(/2 coincidencias.*\[ref/)
  })
})

describe('save_product: lo que mueve el cruce con el catálogo pide el sí', () => {
  test('la marca: la fase 1 avisa del cruce y de la descripción oficial; con la clave escribe en mayúsculas', async () => {
    state.db = table([PRODUCT()], [{ code: '6954', brand: 'SURTEK', description: 'Oficial SURTEK' }])
    const { first, second } = await both({ etm: '1180234', marca: 'surtek' })
    expect(parse(textOf(first))).toMatchObject({ accion: 'simulado', escrito: false, cambios: { marca: { antes: 'URREA', ahora: 'SURTEK' } } })
    expect(parse(textOf(first)).avisos).toEqual([expect.stringMatching(/cruce con el catálogo/), 'Descripción oficial del catálogo: ninguna → «Oficial SURTEK».'])
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(updates(state.db).map((c) => c.payload)).toEqual([{ brand: 'SURTEK' }])
  })

  test('renombrar el ETM avisa que desliga el producto, y un ETM ya tomado es error', async () => {
    state.db = table([PRODUCT(), PRODUCT({ id: ID(2), etm: 'OTRO' })])
    const taken = await call({ etm: '1180234', nuevo_etm: 'OTRO' })
    expect(textOf(taken)).toMatch(/Ya existe un producto con el ETM OTRO/)
    const { first, second } = await both({ etm: '1180234', nuevo_etm: 'NUEVO-1' })
    expect(parse(textOf(first)).avisos).toEqual([expect.stringMatching(/desliga/)])
    expect(second?.isError).toBeFalsy()
    expect(updates(state.db).map((c) => c.payload)).toEqual([{ etm: 'NUEVO-1' }])
  })

  test('la fase 1 sola nunca escribe', async () => {
    state.db = table()
    await call({ etm: '1180234', codigo_modelo: '6954A' })
    await call({ etm: '1180234', codigo_modelo: '6954A' })
    expect(updates(state.db)).toEqual([])
  })

  test('REGLA: repetir la clave después de escribir no escribe otra vez (la huella cambió con la escritura)', async () => {
    state.db = table()
    const mcp = await connectMcp('admin')
    try {
      const first = parse(textOf(await mcp.call('save_product', { etm: '1180234', marca: 'FOY' })))
      await mcp.call('save_product', { etm: '1180234', marca: 'FOY', clave: first.clave })
      const again = await mcp.call('save_product', { etm: '1180234', marca: 'FOY', clave: first.clave })
      // The product already is FOY: there is nothing left to do.
      expect(parse(textOf(again))).toMatchObject({ accion: 'sin_cambios', escrito: false })
    } finally {
      await mcp.close()
    }
    expect(updates(state.db)).toHaveLength(1)
  })

  test('la huella: si otro lo editó entre el resumen y el sí, no escribe', async () => {
    state.db = table()
    const mcp = await connectMcp('admin')
    let after: MockSupabaseClient
    try {
      const first = parse(textOf(await mcp.call('save_product', { etm: '1180234', marca: 'FOY' })))
      after = state.db = table([PRODUCT({ price: 300, updated_at: '2026-10-03T10:00:00Z' })])
      const second = await mcp.call('save_product', { etm: '1180234', marca: 'FOY', clave: first.clave })
      expect(second.isError).toBe(true)
      expect(textOf(second)).toBe('El producto 1180234 cambió desde el resumen: vuelve a pedirlo. No escribí nada.')
    } finally {
      await mcp.close()
    }
    expect(updates(after)).toEqual([])
  })

  test('sin MCP_PREVIEW_SECRET lo directo sigue funcionando y lo que pide el sí falla cerrado; un member ni la recibe', async () => {
    state.db = table()
    vi.stubEnv('MCP_PREVIEW_SECRET', '')
    expect(parse(textOf(await call({ etm: '1180234', precio: 5 }))).accion).toBe('actualizado')
    const closed = await call({ etm: '1180234', marca: 'FOY' })
    expect(closed.isError).toBe(true)
    expect(textOf(closed)).toMatch(/todavía no está activada/)
    const member = await connectMcp('member')
    try {
      expect((await member.tools()).map((t) => t.name)).not.toContain('save_product')
    } finally {
      await member.close()
    }
    expect(updates(state.db)).toHaveLength(1)
  })
})

describe('save_product: alta', () => {
  test('crear con ETM propio escribe directo; con código y sin marca queda URREA (ADR-002) y lo avisa', async () => {
    state.db = table()
    const result = parse(textOf(await call({ etm: 'NUEVO-9', crear: true, codigo_modelo: 'MC9', descripcion_es: 'Algo', precio: 10 })))
    expect(result).toMatchObject({ accion: 'creado', escrito: true, producto: { etm: 'NUEVO-9', codigo: 'MC9', marca: 'URREA', precio: 10 } })
    expect(result.avisos).toEqual([expect.stringMatching(/quedó URREA/)])
    expect(inserts(state.db)[0].payload).toMatchObject({ etm: 'NUEVO-9', model_code: 'MC9', brand: 'URREA', price: 10, is_sold: null })
  })

  test('sin código ni marca no inventa URREA', async () => {
    state.db = table()
    await call({ etm: 'SIN-CODIGO', crear: true })
    expect(inserts(state.db)[0].payload).toMatchObject({ brand: '', model_code: '' })
  })

  test('«nuevo» toma el siguiente DYMMSA-N', async () => {
    state.db = table([PRODUCT({ etm: 'DYMMSA-7' }), PRODUCT({ id: ID(2), etm: 'DYMMSA-12' })])
    const result = parse(textOf(await call({ etm: 'nuevo', crear: true, descripcion_es: 'Boquilla de 1/2' })))
    expect(result).toMatchObject({ accion: 'creado', producto: { etm: 'DYMMSA-13' } })
    expect(result.avisos).toContain('Código interno asignado: DYMMSA-13.')
  })

  test('un ETM que ya existe, `nuevo_etm` al crear y la curada oficial son errores que no escriben', async () => {
    state.db = table([PRODUCT()], [{ code: 'MC9', brand: 'URREA', description: 'Oficial' }])
    expect(textOf(await call({ etm: '1180234', crear: true }))).toMatch(/Ya existe el ETM 1180234/)
    expect(textOf(await call({ etm: 'X1', crear: true, nuevo_etm: 'X2' }))).toMatch(/renombra un producto existente/)
    expect(textOf(await call({ etm: 'X3', crear: true, codigo_modelo: 'MC9', descripcion_dymmsa: 'copia' }))).toMatch(/descripción oficial/)
    expect(inserts(state.db)).toEqual([])
  })


  test('si otro toma DYMMSA-N entre la lectura y el insert, reintenta con el siguiente', async () => {
    const rows = [PRODUCT({ etm: 'DYMMSA-1' })]
    let attempts = 0
    state.db = createMockSupabase({
      responses: {
        'etm_products.select': (rec: CallRecord) => (rec.filters.some((f) => f.method === 'like') ? { data: rows.map((r) => ({ etm: r.etm })), error: null } : { data: [], error: null }),
        'etm_products.insert': (rec: CallRecord) => {
          // The first insert collides: another admin just took DYMMSA-2.
          if (++attempts === 1) {
            rows.push(PRODUCT({ id: ID(2), etm: 'DYMMSA-2' }))
            return { data: null, error: { code: '23505' } }
          }
          return { data: PRODUCT({ id: ID(3), ...(rec.payload as object) }), error: null }
        },
      },
    })
    const result = parse(textOf(await call({ etm: 'nuevo', crear: true })))
    expect(result).toMatchObject({ accion: 'creado', producto: { etm: 'DYMMSA-3' } })
    expect(attempts).toBe(2)
  })
})
