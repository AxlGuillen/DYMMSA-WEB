/** delete_record (#155 C6, ADR-041 §4) through the real SDK: always two phases, and what it blocks or loses is said before the yes. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CallRecord, MockSupabaseClient } from '../helpers/supabase-mock'

const state = vi.hoisted(() => ({ db: null as unknown as MockSupabaseClient }))

vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => state.db), verifierClient: vi.fn() }))

import { createMockSupabase } from '../helpers/supabase-mock'
import { authAs, connectMcp, textOf } from './harness'
import { TEST_PREVIEW_SECRET } from '../helpers/preview-secret'

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000000${n}`
const SUPPLIER = { id: ID(1), name: 'Tornillos MX', payment_terms_days: 30 }
const BRAND = { id: ID(2), name: 'SURTEK' }
const PAYABLE = (over: Record<string, unknown> = {}) => ({
  id: ID(3), supplier_id: SUPPLIER.id, concept: 'Tornillería', amount: 800, currency: 'MXN', invoice_date: '2026-10-01', due_date: '2026-10-31',
  status: 'pending', paid_at: null, notes: null, created_at: '', updated_at: '2026-10-02T10:00:00Z', supplier: SUPPLIER, ...over,
})
const PUNCH = (over: Record<string, unknown> = {}) => ({
  id: ID(4), user_id: ID(9), work_date: '2026-10-06', source_clock_in: '08:02', clock_in: '08:02', clock_out: '17:00', note: null, source: 'import',
  edited_by: null, edited_at: null, original: null, created_at: '', updated_at: '', ...over,
})
const DAY = { id: ID(5), work_date: '2026-10-05', user_id: null, kind: 'holiday', note: 'Aniversario', created_by: null, created_at: '' }
const LUIS = { id: ID(9), display_name: 'Luis', shift: 'full_time' }
const PRESENTATION = { id: ID(6) }

const parse = (text: string) => JSON.parse(text) as Record<string, unknown>

beforeEach(() => {
  vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
})
afterEach(() => vi.unstubAllEnvs())

/** A db that answers the lookups of every tipo and records the deletes. */
function db(over: Record<string, unknown> = {}) {
  return createMockSupabase({
    responses: {
      'suppliers.select': { data: [SUPPLIER], error: null },
      'payables.select': (rec: CallRecord) => (rec.columns === '*' && rec.filters.some((f) => f.method === 'eq' && f.args[0] === 'supplier_id') ? { data: null, count: 0, error: null } : { data: [PAYABLE()], error: null }),
      'suppliers.delete': { data: [{ id: SUPPLIER.id }], error: null },
      'brands.select': { data: [BRAND], error: null },
      'supplier_brands.select': { data: null, count: 0, error: null },
      'brands.delete': { data: [{ id: BRAND.id }], error: null },
      'material_presentations.select': { data: PRESENTATION, error: null },
      'material_presentations.delete': { data: [PRESENTATION], error: null },
      'payables.delete': { data: [{ id: ID(3) }], error: null },
      'profiles.select': { data: [LUIS], error: null },
      'time_entries.select': { data: [PUNCH()], error: null },
      'time_entries.delete': { data: [{ id: ID(4) }], error: null },
      'excused_days.select': { data: DAY, error: null },
      'excused_days.delete': { data: [{ id: ID(5) }], error: null },
      ...over,
    },
  })
}

async function withAdmin<T>(fn: (mcp: Awaited<ReturnType<typeof connectMcp>>) => Promise<T>): Promise<T> {
  const mcp = await connectMcp('admin')
  try {
    return await fn(mcp)
  } finally {
    await mcp.close()
  }
}

/** Phase 1, then the yes: the same arguments plus the key. */
async function deleteBoth(args: Record<string, unknown>) {
  return withAdmin(async (mcp) => {
    const first = parse(textOf(await mcp.call('delete_record', args)))
    const second = await mcp.call('delete_record', { ...args, clave: first.clave })
    return { first, second }
  })
}

const deletes = (client: MockSupabaseClient) => client._calls.filter((c: CallRecord) => c.op === 'delete')

describe('delete_record: siempre en dos fases', () => {
  test.each([
    ['proveedor', { tipo: 'proveedor', referencia: 'Tornillos' }, 'suppliers', 'proveedor', { nombre: 'Tornillos MX', facturas_por_pagar: 0 }],
    ['marca', { tipo: 'marca', referencia: 'surtek' }, 'brands', 'marca', { nombre: 'SURTEK', proveedores: 0 }],
    ['medida', { tipo: 'medida', material: 'tubo', diametro_mm: 25.4, largo_mm: 6000 }, 'material_presentations', 'medida', 'Barra de tubo de 25.4 mm de diámetro, 6 m de largo'],
    ['factura', { tipo: 'factura', referencia: 'Tornillería' }, 'payables', 'factura', { concepto: 'Tornillería', estado: 'pendiente' }],
    ['checada', { tipo: 'checada', persona: 'Luis', fecha: '2026-10-06', entrada: '8:02' }, 'time_entries', 'checada', { persona: 'Luis', entrada: '08:02', salida: '17:00' }],
    ['día justificado', { tipo: 'dia_justificado', fecha: '2026-10-05' }, 'excused_days', 'dia_justificado', { fecha: '2026-10-05', tipo: 'feriado', para: 'todo el equipo' }],
  ] as const)('%s: la fase 1 no borra y trae el resumen y la clave; con la clave borra una vez', async (_label, args, table, key, summary) => {
    state.db = db()
    const { first, second } = await deleteBoth({ ...args })

    expect(first).toMatchObject({ accion: 'simulado', escrito: false })
    expect(first[key]).toMatchObject(typeof summary === 'string' ? {} : summary)
    if (typeof summary === 'string') expect(first[key]).toBe(summary)
    expect(String(first.clave)).toMatch(/^[\w-]+\.[\w-]+$/)
    expect(first.nota).toMatch(/solo con su sí/)

    expect(second.isError, textOf(second)).toBeFalsy()
    expect(parse(textOf(second))).toMatchObject({ accion: 'borrado', escrito: true, nota: 'Borrado.' })
    // One delete, on the table asked, after the phase-1 call wrote nothing.
    expect(deletes(state.db).map((c) => c.table)).toEqual([table])
  })

  test('la fase 1 sola nunca borra, aunque se repita', async () => {
    state.db = db()
    await withAdmin(async (mcp) => {
      await mcp.call('delete_record', { tipo: 'factura', referencia: 'Tornillería' })
      await mcp.call('delete_record', { tipo: 'factura', referencia: 'Tornillería' })
    })
    expect(deletes(state.db)).toEqual([])
  })

  test('una checada importada avisa que vuelve con el re-import; una corregida a mano, que se pierde la corrección', async () => {
    state.db = db({ 'time_entries.select': { data: [PUNCH({ edited_at: '2026-10-07T10:00:00Z' })], error: null } })
    const { first } = await deleteBoth({ tipo: 'checada', persona: 'Luis', fecha: '2026-10-06', entrada: '08:02' })
    expect(first.avisos).toEqual([
      'Esta checada vino del reporte del checador: si ese reporte se vuelve a cargar, regresa.',
      'Fue corregida a mano: se pierde la corrección.',
    ])
  })

  test('la huella: si la factura cambió entre el resumen y el sí, no borra', async () => {
    state.db = db()
    await withAdmin(async (mcp) => {
      const first = parse(textOf(await mcp.call('delete_record', { tipo: 'factura', referencia: 'Tornillería' })))
      state.db = db({ 'payables.select': { data: [PAYABLE({ amount: 900, updated_at: '2026-10-03T10:00:00Z' })], error: null } })
      const second = await mcp.call('delete_record', { tipo: 'factura', referencia: 'Tornillería', clave: first.clave })
      expect(second.isError).toBe(true)
      expect(textOf(second)).toBe('La factura «Tornillería» cambió desde el resumen: vuelve a pedirlo. No escribí nada.')
    })
    expect(deletes(state.db)).toEqual([])
  })
})

describe('delete_record: lo que bloquea', () => {
  test('un proveedor con facturas se bloquea con el conteo y no emite clave; el sí tampoco lo borra', async () => {
    state.db = db({ 'payables.select': { data: null, count: 3, error: null } })
    const { first, second } = await deleteBoth({ tipo: 'proveedor', referencia: 'Tornillos' })
    expect(first).toMatchObject({ accion: 'simulado', escrito: false })
    expect(first.bloqueos).toEqual(['El proveedor tiene facturas por pagar registradas — elimínalas o reasígnalas primero (tiene 3).'])
    expect(first).not.toHaveProperty('clave')
    // With no key to repeat, the second call is just another summary.
    expect(parse(textOf(second))).toMatchObject({ accion: 'simulado', bloqueos: first.bloqueos })

    // A key from before the invoices appeared does not serve: the fingerprint moved.
    state.db = db()
    await withAdmin(async (mcp) => {
      const clean = parse(textOf(await mcp.call('delete_record', { tipo: 'proveedor', referencia: 'Tornillos' })))
      state.db = db({ 'payables.select': { data: null, count: 3, error: null } })
      const late = await mcp.call('delete_record', { tipo: 'proveedor', referencia: 'Tornillos', clave: clean.clave })
      expect(late.isError).toBe(true)
      expect(textOf(late)).toBe('El proveedor «Tornillos MX» cambió desde el resumen: vuelve a pedirlo. No escribí nada.')
    })
    expect(deletes(state.db)).toEqual([])
  })

  test('una marca en uso se bloquea con cuántos proveedores', async () => {
    state.db = db({ 'supplier_brands.select': { data: null, count: 2, error: null } })
    const { first } = await deleteBoth({ tipo: 'marca', referencia: 'SURTEK' })
    expect(first.bloqueos).toEqual(['La marca está asignada a 2 proveedores. Quítala de sus proveedores antes de eliminarla.'])
    expect(deletes(state.db)).toEqual([])
  })

  test('una factura pagada se bloquea: primero regresa a pendiente', async () => {
    state.db = db({ 'payables.select': { data: [PAYABLE({ status: 'paid', paid_at: '2026-10-10' })], error: null } })
    const { first } = await deleteBoth({ tipo: 'factura', referencia: 'Tornillería' })
    expect(first.bloqueos).toEqual(['"Tornillería" está pagada (el 2026-10-10): regrésala a pendiente con save_payable antes de borrarla.'])
    expect(first).not.toHaveProperty('clave')
  })
})

describe('delete_record: entradas', () => {
  test('falta lo que cada tipo necesita: error claro sin tocar la BD', async () => {
    state.db = db()
    await withAdmin(async (mcp) => {
      for (const [args, message] of [
        [{ tipo: 'proveedor' }, /indica `referencia`/],
        [{ tipo: 'medida' }, /indica `material`/],
        [{ tipo: 'medida', material: 'tubo', largo_mm: 6000 }, /necesita diámetro/],
        [{ tipo: 'checada', persona: 'Luis' }, /indica `fecha`/],
        [{ tipo: 'checada', persona: 'Luis', fecha: '2026-10-06' }, /indica su `entrada`/],
        [{ tipo: 'dia_justificado' }, /indica `fecha`/],
      ] as const) {
        const result = await mcp.call('delete_record', { ...args })
        expect(result.isError, JSON.stringify(args)).toBe(true)
        expect(textOf(result)).toMatch(message)
      }
    })
    expect(deletes(state.db)).toEqual([])
  })

  test('un tipo que no existe (cotizacion, orden, producto…) es error de entrada: eso se hace en la app', async () => {
    state.db = db()
    await withAdmin(async (mcp) => {
      for (const tipo of ['cotizacion', 'orden', 'producto', 'inventario', 'catalogo']) {
        const result = await mcp.call('delete_record', { tipo, referencia: 'x' })
        expect(result.isError, tipo).toBe(true)
        expect(textOf(result)).toMatch(/Entrada inválida en delete_record: «tipo»/)
      }
    })
    expect(state.db._calls).toEqual([])
  })

  test('una checada que no existe lista las del día; un día sin justificar lo dice', async () => {
    state.db = db()
    await withAdmin(async (mcp) => {
      const punch = await mcp.call('delete_record', { tipo: 'checada', persona: 'Luis', fecha: '2026-10-06', entrada: '10:00' })
      expect(textOf(punch)).toBe('Luis no tiene una checada con entrada 10:00 el 2026-10-06. Checadas de ese día: 08:02–17:00')
    })
    state.db = db({ 'excused_days.select': { data: null, error: null } })
    await withAdmin(async (mcp) => {
      const day = await mcp.call('delete_record', { tipo: 'dia_justificado', fecha: '2026-10-05' })
      expect(textOf(day)).toBe('El 2026-10-05 no está justificado para todo el equipo.')
    })
  })
})

describe('delete_record: quién y cuándo', () => {
  test('es de administrador: un member no la recibe', async () => {
    const mcp = await connectMcp('member', authAs('member'))
    try {
      expect((await mcp.tools()).map((t) => t.name)).not.toContain('delete_record')
    } finally {
      await mcp.close()
    }
  })

  test('sin MCP_PREVIEW_SECRET no lee ni borra nada', async () => {
    vi.stubEnv('MCP_PREVIEW_SECRET', '')
    state.db = db()
    await withAdmin(async (mcp) => {
      const result = await mcp.call('delete_record', { tipo: 'factura', referencia: 'Tornillería' })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/todavía no está activada/)
    })
    expect(state.db._calls).toEqual([])
  })

  test('la clave de otra herramienta o de otros argumentos no borra', async () => {
    state.db = db()
    await withAdmin(async (mcp) => {
      const first = parse(textOf(await mcp.call('delete_record', { tipo: 'factura', referencia: 'Tornillería' })))
      const other = await mcp.call('delete_record', { tipo: 'proveedor', referencia: 'Tornillos', clave: first.clave })
      expect(textOf(other)).toBe('Los datos son distintos a los del resumen: pide el resumen de nuevo. No escribí nada.')
    })
    expect(deletes(state.db)).toEqual([])
  })

  test('es E(1,1): destructiva e idempotente, y el contrato dice «dos fases»', async () => {
    await withAdmin(async (mcp) => {
      const tool = (await mcp.tools()).find((t) => t.name === 'delete_record')
      expect(tool?.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false })
      expect(tool?.inputSchema.properties).toHaveProperty('clave')
      expect(tool?.description).toMatch(/Dos fases siempre/)
    })
  })
})
