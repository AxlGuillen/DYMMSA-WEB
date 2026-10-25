/** save_quotation and get_quotation.link_aprobacion (#155 D) through the real SDK: one intention per call, the yes for the risky ones. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CallRecord, MockSupabaseClient } from '../helpers/supabase-mock'

const state = vi.hoisted(() => ({ db: null as unknown as MockSupabaseClient }))

vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => state.db), verifierClient: vi.fn() }))

import { filterValue } from '../helpers/supabase-mock'
import { quotationDb, lineId, Q_ID, TOKEN, type FakeLine } from '../helpers/quotation-rpc'
import { authAs, connectMcp, textOf } from './harness'
import { TEST_PREVIEW_SECRET } from '../helpers/preview-secret'

const parse = (text: string) => JSON.parse(text) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
})
afterEach(() => vi.unstubAllEnvs())

const product = (n: number, over: Partial<FakeLine> = {}): Partial<FakeLine> => ({
  item_type: 'product', etm: `ETM-${n}`, model_code: `MC${n}`, brand: 'URREA', description: `Pieza ${n}`, description_es: `Pieza ${n}`,
  dymmsa_description: null, unit_price: 100 * n, quantity: n, delivery_time: 'immediate', notes: null, ...over,
})
const section = (label: string): Partial<FakeLine> => ({ item_type: 'separator', section_label: label, etm: null, is_approved: null, is_sold: null })
const CATALOG = (etm: string, over: Record<string, unknown> = {}) => ({
  id: `p-${etm}`, etm, description: `Cat ${etm}`, description_es: `Catálogo ${etm}`, model_code: `CM-${etm}`, brand: 'URREA', price: 50, is_sold: null,
  dymmsa_description: null, ...over,
})

interface World {
  status?: string
  lines?: Partial<FakeLine>[]
  catalog?: ReturnType<typeof CATALOG>[]
  order?: { id: string } | null
  approvedAt?: string | null
  /** urrea_catalog rows: the official descriptions. */
  official?: { code: string; brand: string; description: string }[]
  twinsError?: boolean
}

/** Quotation tables with the update_quotation fake of #157, plus what the tool reads around them. */
const NEW_ID = '44444444-4444-4444-8444-444444444444'

function world({ status = 'draft', lines, catalog = [], order = null, approvedAt = null, official = [], twinsError = false }: World = {}) {
  const base = lines ?? [section('Tornillería'), product(1), product(2), product(3, { unit_price: 350 })]
  let clock = 0
  let updatedAt = '2026-10-01T10:00:00Z'
  const bump = () => (updatedAt = `2026-10-24T10:00:${String(++clock).padStart(2, '0')}Z`)
  const created: Record<string, unknown>[] = []
  const twins: { id: string }[] = []
  const fake = quotationDb({
    quotation: { status, approved_at: approvedAt },
    lines: base,
    responses: {
      'quotations.select': (rec: CallRecord) => {
        if (rec.columns === 'id') return twinsError ? { data: null, error: { code: 'XX000', message: 'boom' } } : { data: twins, error: null }
        const or = rec.filters.find((f) => f.method === 'or')
        if (or) return { data: [{ id: Q_ID, name: fake.quotation.name, customer_name: fake.quotation.customer_name, status: fake.quotation.status }], error: null }
        const id = filterValue(rec, 'id')
        if (id !== Q_ID) return { data: null, error: { code: 'PGRST116' } }
        const row = { ...fake.quotation, updated_at: updatedAt, created_at: '' }
        return { data: rec.columns?.includes('quotation_items') ? { ...row, quotation_items: fake.lines().map((l) => ({ notes: null, created_at: '', ...l })) } : row, error: null }
      },
      'quotations.update': (rec: CallRecord) => {
        Object.assign(fake.quotation, rec.payload)
        bump()
        return { data: { ...fake.quotation }, error: null }
      },
      'quotations.insert': (rec: CallRecord) => {
        created.push(rec.payload as Record<string, unknown>)
        twins.push({ id: 'tw-1' })
        return { data: { id: NEW_ID, ...(rec.payload as object) }, error: null }
      },
      'quotation_items.insert': { data: null, error: null },
      'etm_products.select': (rec: CallRecord) => {
        if (rec.filters.some((f) => f.method === 'like')) return { data: catalog.filter((c) => c.etm.startsWith('DYMMSA-')).map((c) => ({ etm: c.etm })), error: null }
        const wanted = (rec.filters.find((f) => f.method === 'in')?.args[1] as string[] | undefined) ?? []
        return { data: catalog.filter((c) => wanted.includes(c.etm)), error: null }
      },
      'etm_products.insert': { data: null, error: null },
      'etm_products.update': { data: null, error: null },
      'urrea_catalog.select': { data: official, error: null },
      // get_quotation reads it with maybeSingle; the linked-order guard of the status change reads a list.
      'orders.select': (rec: CallRecord) => ({ data: rec.single ? (order ? { name: 'ORD-1', status: 'ordered', ...order } : null) : order ? [order] : [], error: null }),
    },
  })
  const rpc = fake.client.rpc.bind(fake.client)
  fake.client.rpc = async (fn, params) => {
    const result = await rpc(fn, params)
    if (fn === 'update_quotation' && !result.error) bump()
    return result
  }
  return { ...fake, created, version: () => updatedAt }
}

const writes = (db: MockSupabaseClient) => db._calls.filter((c) => ['update', 'insert', 'upsert', 'delete'].includes(c.op) && !['etm_products'].includes(c.table)).length + db._rpcCalls.length

async function asAdmin<T>(fn: (mcp: Awaited<ReturnType<typeof connectMcp>>) => Promise<T>): Promise<T> {
  const mcp = await connectMcp('admin', authAs('admin', 'admin-1'))
  try {
    return await fn(mcp)
  } finally {
    await mcp.close()
  }
}

/** Phase 1, the yes, phase 2; `afterFirst` counts the writes phase 1 had done when the yes arrived. */
async function both(args: Record<string, unknown>) {
  return asAdmin(async (mcp) => {
    const first = await mcp.call('save_quotation', args)
    const key = first.isError ? null : parse(textOf(first)).clave
    const afterFirst = writes(state.db)
    const second = key ? await mcp.call('save_quotation', { ...args, clave: key }) : null
    return { first, second, afterFirst }
  })
}

const call = (args: Record<string, unknown>) => asAdmin((mcp) => mcp.call('save_quotation', args))

describe('save_quotation: editar por línea', () => {
  test('eval 1: precio de la línea 4 y entrega a todo; la fase 1 muestra línea por línea y el total sin escribir; con la clave escribe una vez y las líneas conservan su id', async () => {
    const w = world()
    state.db = w.client
    const { first, second, afterFirst } = await both({ cotizacion: 'COT-001', cambios: [{ linea: 4, precio: 385 }, { linea: 'todas', entrega: '1_semana' }] })
    expect(afterFirst).toBe(0)
    const one = parse(textOf(first))
    expect(one).toMatchObject({ accion: 'simulado', escrito: false })
    expect(one.cambios['linea 4 (ETM ETM-3)']).toEqual({ antes: { precio: 350, entrega: 'inmediata' }, ahora: { precio: 385, entrega: '1_semana' } })
    expect(one.cambios['linea 2 (ETM ETM-1)']).toEqual({ antes: { entrega: 'inmediata' }, ahora: { entrega: '1_semana' } })
    expect(one.cambios).not.toHaveProperty('linea 1 (sección «Tornillería»)')
    // 100×1 + 200×2 + 350×3 = 1550 → 100 + 400 + 385×3 = 1655
    expect(one.cambios.total).toEqual({ antes: 1550, ahora: 1655 })
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(parse(textOf(second!))).toMatchObject({ accion: 'actualizado', escrito: true, cotizacion: { total: 1655 } })

    expect(w.rpcParams('update_quotation')).toHaveLength(1)
    expect(w.lines().map((l) => [l.id, l.unit_price, l.delivery_time])).toEqual([
      [lineId(1), null, null],
      [lineId(2), 100, '1_week'],
      [lineId(3), 200, '1_week'],
      [lineId(4), 385, '1_week'],
    ])
  })

  test('la huella: si otro guardó la cotización entre el resumen y el sí, no escribe', async () => {
    state.db = world().client
    const mcp = await connectMcp('admin', authAs('admin', 'admin-1'))
    let after: ReturnType<typeof world>
    try {
      const args = { cotizacion: 'COT-001', cambios: [{ linea: 2, precio: 120 }] }
      const first = parse(textOf(await mcp.call('save_quotation', args)))
      after = world({ lines: [section('Tornillería'), product(1), product(2), product(3), product(4)] })
      state.db = after.client
      const second = await mcp.call('save_quotation', { ...args, clave: first.clave })
      expect(textOf(second)).toBe('La cotización «COT-001» cambió desde el resumen: vuelve a pedirlo. No escribí nada.')
    } finally {
      await mcp.close()
    }
    expect(after.rpcParams('update_quotation')).toEqual([])
  })

  test('REGLA: la clave repetida después de escribir no vuelve a escribir (la versión cambió con la escritura)', async () => {
    const w = world()
    state.db = w.client
    await asAdmin(async (mcp) => {
      const args = { cotizacion: 'COT-001', cambios: [{ linea: 2, precio: 120 }] }
      const key = parse(textOf(await mcp.call('save_quotation', args))).clave
      await mcp.call('save_quotation', { ...args, clave: key })
      // Nothing is left to do (the price already is 120): the key cannot write it twice.
      const again = await mcp.call('save_quotation', { ...args, clave: key })
      expect(parse(textOf(again))).toMatchObject({ accion: 'sin_cambios', escrito: false })
    })
    expect(w.rpcParams('update_quotation')).toHaveLength(1)
  })

  test('`version` de get_quotation: si ya cambió, error antes de planear', async () => {
    const w = world()
    state.db = w.client
    const result = await call({ cotizacion: 'COT-001', version: 'vieja', cambios: [{ linea: 2, precio: 1 }] })
    expect(textOf(result)).toMatch(/cambió desde que la leíste \(versión vieja, ahora [0-9a-f]{12}\)/)
    const ok = parse(textOf(await asAdmin((mcp) => mcp.call('get_quotation', { cotizacion: 'COT-001' }))))
    const accepted = await call({ cotizacion: 'COT-001', version: ok.version, cambios: [{ linea: 2, precio: 1 }] })
    expect(parse(textOf(accepted)).accion).toBe('simulado')
  })

  test('quitar, mover y agregar usan la numeración leída; quitar uno no hace que los demás parezcan movidos', async () => {
    const w = world({ lines: [section('A'), product(1), product(2), product(3)], catalog: [CATALOG('NEW-9')] })
    state.db = w.client
    const { first, second } = await both({
      cotizacion: 'COT-001',
      cambios: [{ linea: 2, quitar: true, etm: 'etm-1' }, { linea: 4, despues_de: 1 }],
      lineas: [{ etm: 'NEW-9', cantidad: 3, despues_de: 3 }],
    })
    const one = parse(textOf(first))
    expect(one.cambios['linea 2 (ETM ETM-1)']).toEqual({ antes: 'estaba', ahora: 'se quita' })
    expect(one.cambios['linea 4 (ETM ETM-3)']).toEqual({ antes: { posicion: 4 }, ahora: { posicion: 2 } })
    expect(one.cambios['linea nueva 4']).toEqual({ antes: null, ahora: 'ETM NEW-9 × 3' })
    expect(Object.keys(one.cambios).some((k) => k.startsWith('linea 3'))).toBe(false)
    expect(second?.isError, textOf(second!)).toBeFalsy()
    // Section, the moved ETM-3, ETM-2, then the new one after the original line 3.
    expect(w.lines().map((l) => l.etm ?? l.section_label)).toEqual(['A', 'ETM-3', 'ETM-2', 'NEW-9'])
    expect(w.lines()[3]).toMatchObject({ description: 'Cat NEW-9', unit_price: 50, quantity: 3 })
  })

  test('errores de línea: guarda del ETM, línea inexistente, sección con precio, sin productos, nada que cambiar', async () => {
    state.db = world().client
    expect(textOf(await call({ cotizacion: 'COT-001', cambios: [{ linea: 2, etm: 'OTRO', precio: 1 }] }))).toBe('La línea 2 es el ETM ETM-1, no OTRO: vuelve a leer la cotización.')
    expect(textOf(await call({ cotizacion: 'COT-001', cambios: [{ linea: 9, precio: 1 }] }))).toBe('No hay línea 9: la cotización tiene 4.')
    expect(textOf(await call({ cotizacion: 'COT-001', cambios: [{ linea: 1, precio: 1 }] }))).toMatch(/La línea 1 es una sección/)
    expect(textOf(await call({ cotizacion: 'COT-001', cambios: [{ linea: [2, 3, 4], quitar: true }] }))).toMatch(/quitar va de una línea a la vez/)
    expect(textOf(await call({ cotizacion: 'COT-001', cambios: [{ linea: 2 }] }))).toMatch(/indica qué cambiar en la línea/)
    expect(textOf(await call({ cotizacion: 'COT-001', cambios: [{ linea: 2, precio: 1, quitar: true }] }))).toMatch(/una operación por elemento/)
    const bare = world({ lines: [section('A'), product(1)] })
    state.db = bare.client
    expect(textOf(await call({ cotizacion: 'COT-001', cambios: [{ linea: 2, quitar: true }] }))).toMatch(/se quedaría sin productos/)
    expect(bare.rpcParams('update_quotation')).toEqual([])
  })

  test('una cantidad o un precio inválidos son errores del esquema; una cantidad que deja la línea incompleta, un bloqueo', async () => {
    state.db = world().client
    expect((await call({ cotizacion: 'COT-001', cambios: [{ linea: 2, cantidad: 2.5 }] })).isError).toBe(true)
    expect((await call({ cotizacion: 'COT-001', cambios: [{ linea: 2, precio: -1 }] })).isError).toBe(true)
    expect((await call({ cotizacion: 'COT-001', cambios: [{ linea: 2, entrega: 'pronto' }] })).isError).toBe(true)
  })

  test('una descripción curada que copia la oficial del catálogo se rechaza (ADR-013)', async () => {
    // urrea_catalog answers with an official description for MC1 under URREA.
    const withCatalog = world({ official: [{ code: 'MC1', brand: 'URREA', description: 'Oficial' }] })
    state.db = withCatalog.client
    const result = await call({ cotizacion: 'COT-001', cambios: [{ linea: 2, descripcion_dymmsa: 'Mi texto' }] })
    expect(textOf(result)).toBe('El ETM ETM-1 tiene descripción oficial en el catálogo URREA y es la que se muestra: no se le puede poner una curada.')
    expect(withCatalog.rpcParams('update_quotation')).toEqual([])
  })

  test('cotizaciones rechazadas y convertidas no se editan, y el error dice cómo seguir', async () => {
    state.db = world({ status: 'rejected' }).client
    expect(textOf(await call({ cotizacion: 'COT-001', cambios: [{ linea: 2, precio: 1 }] }))).toMatch(/Está rechazada: cámbiala a borrador primero/)
    state.db = world({ status: 'converted_to_order' }).client
    expect(textOf(await call({ cotizacion: 'COT-001', cambios: [{ linea: 2, precio: 1 }] }))).toMatch(/Está convertida a orden: elimina la orden/)
  })

  test('encabezado: nombre y cliente se cambian con las líneas intactas', async () => {
    const w = world()
    state.db = w.client
    const { first, second } = await both({ cotizacion: 'COT-001', nombre: 'COT-002', cliente: ' ACME Corp ' })
    expect(parse(textOf(first)).cambios).toEqual({ nombre: { antes: 'COT-001', ahora: 'COT-002' }, cliente: { antes: 'ACME', ahora: 'ACME Corp' } })
    expect(second?.isError).toBeFalsy()
    expect(w.rpcParams('update_quotation')[0].p_header).toMatchObject({ name: 'COT-002', customer_name: 'ACME Corp' })
    expect(w.lines()).toHaveLength(4)
  })
})

describe('save_quotation: aprobación, avisos y auto-aprendizaje', () => {
  const approved = () =>
    world({ status: 'approved', lines: [section('A'), product(1, { is_approved: true }), product(2, { is_approved: true }), product(3, { is_approved: null })] })

  test('decisión 4: cambiar el precio de una línea ya aprobada NO la regresa a pendiente, y el resumen lo avisa', async () => {
    const w = approved()
    state.db = w.client
    const { first, second } = await both({ cotizacion: 'COT-001', cambios: [{ linea: 2, precio: 120 }] })
    expect(parse(textOf(first)).avisos).toContain('La línea 2 (ETM-1) ya estaba aprobada por el cliente a $100 × 1; sigue aprobada a $120 × 1.')
    expect(second?.isError).toBeFalsy()
    expect(w.lines()[1]).toMatchObject({ unit_price: 120, is_approved: true })
  })

  test('eval 3: aprueba todo menos la línea 5 (en aprobada); las líneas nuevas quedan pendientes y lo dice', async () => {
    const w = world({ status: 'approved', lines: [section('A'), product(1), product(2), product(3), product(4)] })
    state.db = w.client
    const { second } = await both({ cotizacion: 'COT-001', cambios: [{ linea: 'todas', aprobacion: 'aprobada' }, { linea: 5, aprobacion: 'rechazada' }] })
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(w.lines().map((l) => l.is_approved)).toEqual([null, true, true, true, false])
    const added = await both({ cotizacion: 'COT-001', lineas: [{ etm: 'X-1', cantidad: 1, precio: 5, codigo: 'C', descripcion: 'Algo' }] })
    expect(parse(textOf(added.first)).avisos).toContain('En una cotización aprobada las líneas nuevas quedan pendientes: no entran a la orden hasta que alguien las apruebe.')
  })

  test('«todas» no aprueba una línea «no lo vendemos»; nombrarla a propósito es error', async () => {
    const w = world({ status: 'approved', lines: [section('A'), product(1), product(2, { is_sold: false })] })
    state.db = w.client
    const { second } = await both({ cotizacion: 'COT-001', cambios: [{ linea: 'todas', aprobacion: 'aprobada' }] })
    expect(w.lines().map((l) => l.is_approved)).toEqual([null, true, null])
    expect(second?.isError).toBeFalsy()
    expect(textOf(await call({ cotizacion: 'COT-001', cambios: [{ linea: 3, aprobacion: 'aprobada' }] }))).toMatch(/«no lo vendemos»: no se puede aprobar/)
  })

  test('en revisión las decisiones son del cliente: aprobacion es error; lo demás se edita y avisa que sus decisiones se conservan', async () => {
    const w = world({ status: 'sent_for_approval', lines: [section('A'), product(1, { is_approved: true }), product(2)] })
    state.db = w.client
    expect(textOf(await call({ cotizacion: 'COT-001', cambios: [{ linea: 2, aprobacion: 'rechazada' }] }))).toMatch(/En revisión las decisiones son del cliente/)
    const { first, second } = await both({ cotizacion: 'COT-001', cambios: [{ linea: 3, entrega: '2_semanas' }] })
    expect(parse(textOf(first)).avisos).toContain('Está en revisión: el cliente puede tener la página abierta. Sus decisiones se conservan.')
    expect(second?.isError).toBeFalsy()
    expect(w.lines()[1].is_approved).toBe(true)
  })

  test('se_vende explícito avisa que se propaga al catálogo; precios nuevos y ETM nuevos avisan lo que aprende el catálogo', async () => {
    const w = world({ catalog: [CATALOG('ETM-1', { price: 99 })] })
    state.db = w.client
    const { first } = await both({ cotizacion: 'COT-001', cambios: [{ linea: 2, se_vende: 'no' }, { linea: 3, precio: 250 }] })
    const avisos = parse(textOf(first)).avisos as string[]
    expect(avisos).toContain('La línea 2 (ETM-1): «se_vende: no» se guarda también en el catálogo ETM, para todas las cotizaciones futuras.')
    expect(avisos.some((a) => /^Al guardar, el catálogo ETM aprende de estas líneas: 1 ETM nuevo entra al catálogo/.test(a) || /ETM nuevo/.test(a))).toBe(true)
  })

  test('el auto-aprendizaje corre por el mismo store y se reporta en el resultado', async () => {
    state.db = world().client
    const { second } = await both({ cotizacion: 'COT-001', cambios: [{ linea: 2, precio: 120 }] })
    expect(parse(textOf(second!)).avisos).toContainEqual(expect.stringMatching(/^Catálogo ETM: \d+ nuevos?, \d+ actualizados?\.$/))
  })
})

describe('save_quotation: crear', () => {
  test('si falla la lectura de cotizaciones con el mismo nombre, es error y no una clave que luego parezca «cambió»', async () => {
    state.db = world({ catalog: [CATALOG('1180234')], twinsError: true }).client
    const result = await call({ nombre: 'COT-X', cliente: 'GE', lineas: [{ etm: '1180234', cantidad: 1 }] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/No pude revisar si ya existe una cotización/)
  })

  test('eval 2: prellena del catálogo, avisa los ETM que no están y «nuevo»; la fase 1 no escribe; con la clave crea y aprende', async () => {
    const w = world({ catalog: [CATALOG('1180234'), CATALOG('DYMMSA-7')] })
    state.db = w.client
    const args = {
      nombre: 'COT-GE-01',
      cliente: 'GE Power',
      lineas: [
        { seccion: 'Pinturas' },
        { etm: '1180234', cantidad: 6 },
        { etm: 'NOEXISTE', cantidad: 2, precio: 80, codigo: 'NX1', descripcion: 'Pieza nueva' },
        { etm: 'nuevo', cantidad: 1, precio: 10, descripcion: 'Boquilla' },
      ],
    }
    const { first, second, afterFirst } = await both(args)
    expect(afterFirst).toBe(0)
    const one = parse(textOf(first))
    expect(one).toMatchObject({ accion: 'simulado', escrito: false, cotizacion: { nombre: 'COT-GE-01', cliente: 'GE Power', estado: 'borrador', productos: 3, total: 6 * 50 + 160 + 10 } })
    expect(one.cotizacion.lineas[1]).toMatchObject({ linea: 2, etm: '1180234', codigo: 'CM-1180234', descripcion: 'Catálogo 1180234', cantidad: 6, precio: 50, importe: 300, entrega: 'inmediata' })
    expect(one.avisos).toContain('«nuevo» quedó como DYMMSA-8.')
    expect(one.avisos).toContainEqual(expect.stringMatching(/El ETM NOEXISTE no está en el catálogo/))
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(parse(textOf(second!))).toMatchObject({ accion: 'creado', escrito: true, cotizacion: { ref: '44444444' } })
    expect(w.created[0]).toMatchObject({ name: 'COT-GE-01', customer_name: 'GE Power', status: 'draft' })
    expect(state.db.callsTo('quotation_items', 'insert')[0].payload).toHaveLength(4)
  })

  test('una línea sin cantidad es un bloqueo sin clave; sin nombre, cliente o productos son errores', async () => {
    const w = world({ catalog: [CATALOG('1180234')] })
    state.db = w.client
    const { first, second } = await both({ nombre: 'X', cliente: 'Y', lineas: [{ etm: '1180234' }] })
    expect(parse(textOf(first)).bloqueos).toEqual(['ETM "1180234": la cantidad debe ser un entero mayor a 0.'])
    expect(parse(textOf(first))).not.toHaveProperty('clave')
    expect(second).toBeNull()
    expect(textOf(await call({ nombre: 'X', lineas: [{ etm: 'A', cantidad: 1 }] }))).toMatch(/indica `nombre`, `cliente` y `lineas`/)
    expect(textOf(await call({ nombre: 'X', cliente: 'Y', lineas: [{ seccion: 'Solo sección' }] }))).toBe('Se requiere al menos un producto.')
    expect(textOf(await call({ nombre: 'X', cliente: 'Y', lineas: [{ etm: 'A', seccion: 'B', cantidad: 1 }] }))).toMatch(/o es una sección/)
    expect(textOf(await call({ nombre: 'X', cliente: 'Y', lineas: [{ cantidad: 1 }] }))).toMatch(/indica el ETM/)
    expect(w.created).toEqual([])
  })

  test('crear no es idempotente, así que repetir la clave después de crear no crea una gemela', async () => {
    const w = world({ catalog: [CATALOG('1180234')] })
    state.db = w.client
    await asAdmin(async (mcp) => {
      const args = { nombre: 'COT-1', cliente: 'ACME', lineas: [{ etm: '1180234', cantidad: 1 }] }
      const key = parse(textOf(await mcp.call('save_quotation', args))).clave
      await mcp.call('save_quotation', { ...args, clave: key })
      const again = await mcp.call('save_quotation', { ...args, clave: key })
      expect(again.isError).toBe(true)
      expect(textOf(again)).toMatch(/cambió desde el resumen/)
    })
    expect(w.created).toHaveLength(1)
  })

  test('`despues_de` y `cambios` no se usan al crear; `lineas` junto a `estado` son dos intenciones', async () => {
    state.db = world({ catalog: [CATALOG('A')] }).client
    expect(textOf(await call({ nombre: 'X', cliente: 'Y', lineas: [{ etm: 'A', cantidad: 1, despues_de: 1 }] }))).toMatch(/solo se usa al agregar líneas a una cotización existente/)
    expect(textOf(await call({ cambios: [{ linea: 1, precio: 1 }] }))).toMatch(/indica `cotizacion`/)
    expect(textOf(await call({ cotizacion: 'COT-001', estado: 'aprobada', lineas: [{ etm: 'A', cantidad: 1 }] }))).toMatch(/Una intención por llamada/)
  })
})

describe('save_quotation: estado', () => {
  test('borrador → en_revision es directo: valida las líneas, conserva el link y lo devuelve', async () => {
    const w = world()
    state.db = w.client
    const result = await call({ cotizacion: 'COT-001', estado: 'en_revision' })
    expect(result.isError, textOf(result)).toBeFalsy()
    const out = parse(textOf(result))
    expect(out).toMatchObject({ accion: 'actualizado', escrito: true, cotizacion: { estado: 'en_revision', link_aprobacion: expect.stringMatching(new RegExp(`/approve/${TOKEN}$`)) } })
    expect(out).not.toHaveProperty('clave')
    // send-for-approval keeps the token: the payload only moves the status.
    expect(state.db.callsTo('quotations', 'update')[0].payload).toEqual({ status: 'sent_for_approval' })
  })

  test('mandarla a revisión con una línea incompleta es un bloqueo y no escribe', async () => {
    const w = world({ lines: [section('A'), product(1, { quantity: null })] })
    state.db = w.client
    const result = parse(textOf(await call({ cotizacion: 'COT-001', estado: 'en_revision' })))
    expect(result).toMatchObject({ accion: 'simulado', escrito: false, bloqueos: ['ETM "ETM-1": la cantidad debe ser un entero mayor a 0.'] })
    expect(state.db.callsTo('quotations', 'update')).toEqual([])
  })

  test('aprobada pide el sí: avisa que el link muere y que sella aprobada_el; con la clave regenera el token y sella la fecha', async () => {
    const w = world({ status: 'sent_for_approval', lines: [section('A'), product(1, { is_approved: true })] })
    state.db = w.client
    const { first, second, afterFirst } = await both({ cotizacion: 'COT-001', estado: 'aprobada' })
    expect(afterFirst).toBe(0)
    const one = parse(textOf(first))
    expect(one).toMatchObject({ accion: 'simulado', cambios: { estado: { antes: 'en_revision', ahora: 'aprobada' } } })
    expect(one.avisos).toEqual(['Cambiar el estado regenera el link de aprobación: el anterior deja de servir.', 'Sella la fecha de aprobación (aprobada_el) y ya no se borra.'])
    expect(second?.isError, textOf(second!)).toBeFalsy()
    const payload = state.db.callsTo('quotations', 'update')[0].payload as Record<string, string>
    expect(payload.status).toBe('approved')
    expect(payload.approval_token).not.toBe(TOKEN)
    expect(payload.approved_at).toMatch(/^2026-/)
  })

  test('aprobada sin ninguna línea aprobada lo avisa; una que ya tenía fecha la conserva', async () => {
    state.db = world({ status: 'draft' }).client
    const { first } = await both({ cotizacion: 'COT-001', estado: 'aprobada' })
    expect(parse(textOf(first)).avisos).toContain('No hay líneas aprobadas: la orden no se podrá generar hasta aprobar alguna.')
    state.db = world({ status: 'rejected', approvedAt: '2026-09-01T00:00:00Z' }).client
    const again = await both({ cotizacion: 'COT-001', estado: 'aprobada' })
    expect(parse(textOf(again.first)).avisos).toContain('Conserva la fecha de la primera aprobación.')
    expect((state.db.callsTo('quotations', 'update')[0].payload as Record<string, unknown>).approved_at).toBeUndefined()
  })

  test('el mismo estado es sin_cambios; «convertida» no es un destino; un estado inventado es error', async () => {
    state.db = world({ status: 'approved' }).client
    expect(parse(textOf(await call({ cotizacion: 'COT-001', estado: 'aprobada' }))).accion).toBe('sin_cambios')
    expect((await call({ cotizacion: 'COT-001', estado: 'convertida' })).isError).toBe(true)
    expect((await call({ cotizacion: 'COT-001', estado: 'pagada' })).isError).toBe(true)
    expect(state.db.callsTo('quotations', 'update')).toEqual([])
  })

  test('reabrir una convertida con su orden viva es un bloqueo; sin orden, se puede', async () => {
    state.db = world({ status: 'converted_to_order', order: { id: 'o1' } }).client
    const blocked = await both({ cotizacion: 'COT-001', estado: 'borrador' })
    expect(parse(textOf(blocked.first)).bloqueos).toEqual(['Elimina la orden vinculada (en la app) antes de reabrir esta cotización.'])
    expect(blocked.second).toBeNull()
    state.db = world({ status: 'converted_to_order' }).client
    const free = await both({ cotizacion: 'COT-001', estado: 'borrador' })
    expect(free.second?.isError, textOf(free.second!)).toBeFalsy()
  })

  test('cambiar de estado y editar líneas en la misma llamada son dos intenciones', async () => {
    state.db = world().client
    expect(textOf(await call({ cotizacion: 'COT-001', estado: 'aprobada', cambios: [{ linea: 2, precio: 1 }] }))).toMatch(/dos llamadas, cada una con su resumen/)
    expect(textOf(await call({ cotizacion: 'COT-001' }))).toMatch(/Indica qué hacer/)
  })

  test('la huella: si cambió el estado entre el resumen y el sí, no escribe', async () => {
    state.db = world({ status: 'draft' }).client
    const mcp = await connectMcp('admin', authAs('admin', 'admin-1'))
    let after: ReturnType<typeof world>
    try {
      const first = parse(textOf(await mcp.call('save_quotation', { cotizacion: 'COT-001', estado: 'aprobada' })))
      after = world({ status: 'rejected' })
      state.db = after.client
      const second = await mcp.call('save_quotation', { cotizacion: 'COT-001', estado: 'aprobada', clave: first.clave })
      expect(textOf(second)).toMatch(/cambió desde el resumen/)
    } finally {
      await mcp.close()
    }
    expect(after.client.callsTo('quotations', 'update')).toEqual([])
  })
})

describe('save_quotation: permisos y secreto', () => {
  test('sin MCP_PREVIEW_SECRET: borrador → en_revision (directo) sigue funcionando; editar y los demás estados fallan cerrados', async () => {
    const w = world()
    state.db = w.client
    vi.stubEnv('MCP_PREVIEW_SECRET', '')
    expect(parse(textOf(await call({ cotizacion: 'COT-001', estado: 'en_revision' }))).accion).toBe('actualizado')
    state.db = world().client
    const edit = await call({ cotizacion: 'COT-001', cambios: [{ linea: 2, precio: 5 }] })
    expect(edit.isError).toBe(true)
    expect(textOf(edit)).toMatch(/todavía no está activada/)
    expect((await call({ cotizacion: 'COT-001', estado: 'aprobada' })).isError).toBe(true)
  })

  test('un member ni recibe la tool; un campo desconocido es error', async () => {
    state.db = world().client
    const member = await connectMcp('member')
    try {
      expect((await member.tools()).map((t) => t.name)).not.toContain('save_quotation')
    } finally {
      await member.close()
    }
    expect((await call({ cotizacion: 'COT-001', borrar: true })).isError).toBe(true)
    expect((await call({ cotizacion: 'COT-001', cambios: [{ linea: 1, id: 'abc' }] })).isError).toBe(true)
  })
})

describe('get_quotation: link_aprobacion', () => {
  test('el administrador lo recibe mientras está en revisión; en otro estado no; un member nunca', async () => {
    state.db = world({ status: 'sent_for_approval' }).client
    const admin = parse(textOf(await asAdmin((mcp) => mcp.call('get_quotation', { cotizacion: 'COT-001' }))))
    expect(admin.link_aprobacion).toMatch(new RegExp(`^https?://[^/]+/approve/${TOKEN}$`))

    const member = await connectMcp('member')
    try {
      expect(parse(textOf(await member.call('get_quotation', { cotizacion: 'COT-001' })))).not.toHaveProperty('link_aprobacion')
    } finally {
      await member.close()
    }

    state.db = world({ status: 'draft' }).client
    expect(parse(textOf(await asAdmin((mcp) => mcp.call('get_quotation', { cotizacion: 'COT-001' }))))).not.toHaveProperty('link_aprobacion')
  })
})
