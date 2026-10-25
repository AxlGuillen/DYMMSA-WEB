/** save_profile (#155 D) through the real SDK: one's own name and NSS write directly; the rest asks for the yes. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CallRecord, MockSupabaseClient } from '../helpers/supabase-mock'

const state = vi.hoisted(() => ({ db: null as unknown as MockSupabaseClient }))

vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => state.db), verifierClient: vi.fn() }))

import { createMockSupabase, filterValue, hasFilter } from '../helpers/supabase-mock'
import { authAs, connectMcp, textOf } from './harness'
import { TEST_PREVIEW_SECRET } from '../helpers/preview-secret'

const ME = '11111111-1111-4111-8111-111111111111'
const DIEGO = '22222222-2222-4222-8222-222222222222'
const VALID_NSS = '12345678903'

const PROFILE = (over: Record<string, unknown> = {}) => ({
  id: DIEGO, display_name: 'Diego', role: 'member', area: 'office', clock_employee_id: 4, shift: 'full_time', nss: null, avatar_path: null,
  is_owner: false, updated_at: '2026-10-01T10:00:00Z', ...over,
})
const AXL = PROFILE({ id: ME, display_name: 'Axl', role: 'admin', clock_employee_id: null, shift: null })

const parse = (text: string) => JSON.parse(text) as Record<string, unknown>

beforeEach(() => {
  vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
})
afterEach(() => vi.unstubAllEnvs())

/** profiles as PostgREST answers the lookups of the tool; an update bumps updated_at, as the trigger does. */
function table(people: ReturnType<typeof PROFILE>[] = [AXL, PROFILE()]) {
  const rows = [...people]
  let clock = 0
  return createMockSupabase({
    responses: {
      'profiles.select': (rec: CallRecord) => {
        if (hasFilter(rec, 'role')) return { data: null, count: rows.filter((r) => r.role === 'admin').length, error: null }
        const ilike = rec.filters.find((f) => f.method === 'ilike')
        if (ilike) {
          const needle = String(ilike.args[1]).replace(/%/g, '').toLowerCase()
          return { data: rows.filter((r) => r.display_name.toLowerCase().includes(needle)), error: null }
        }
        const clock_id = filterValue(rec, 'clock_employee_id')
        if (clock_id !== undefined) return { data: rows.filter((r) => r.clock_employee_id === clock_id && r.id !== filterValue(rec, 'id', 'neq')), error: null }
        const id = filterValue(rec, 'id')
        const found = rows.find((r) => r.id === id) ?? null
        return { data: found, error: found ? null : { code: 'PGRST116' } }
      },
      'profiles.update': (rec: CallRecord) => {
        const row = rows.find((r) => r.id === filterValue(rec, 'id'))
        if (row) Object.assign(row, rec.payload, { updated_at: `2026-10-02T10:00:0${++clock}Z` })
        return { data: null, error: null }
      },
    },
  })
}

async function both(args: Record<string, unknown>) {
  const mcp = await connectMcp('admin', authAs('admin', ME))
  try {
    const first = await mcp.call('save_profile', args)
    const key = first.isError ? null : parse(textOf(first)).clave
    const afterFirst = state.db._calls.filter((c) => c.op !== 'select').length
    const second = key ? await mcp.call('save_profile', { ...args, clave: key }) : null
    return { first, second, afterFirst }
  } finally {
    await mcp.close()
  }
}

async function call(args: Record<string, unknown>) {
  const mcp = await connectMcp('admin', authAs('admin', ME))
  try {
    return await mcp.call('save_profile', args)
  } finally {
    await mcp.close()
  }
}

const updates = (db: MockSupabaseClient) => db.callsTo('profiles', 'update')

describe('save_profile: lo propio es directo', () => {
  test('mi nombre y mi NSS se guardan en una llamada; el NSS vuelve enmascarado', async () => {
    state.db = table()
    const result = await call({ nombre: '  Axl Guillén ', nss: '1234 5678 903' })
    expect(result.isError, textOf(result)).toBeFalsy()
    const out = parse(textOf(result))
    expect(out).toMatchObject({ accion: 'actualizado', escrito: true, persona: { nombre: 'Axl Guillén', nss: '•••••••8903' } })
    expect(out.cambios).toEqual({ nombre: { antes: 'Axl', ahora: 'Axl Guillén' }, nss: { antes: null, ahora: '•••••••8903' } })
    expect(JSON.stringify(out)).not.toContain(VALID_NSS)
    expect(updates(state.db).map((c) => c.payload)).toEqual([{ display_name: 'Axl Guillén', nss: VALID_NSS }])
  })

  test('texto vacío borra el NSS', async () => {
    state.db = table([PROFILE({ id: ME, display_name: 'Axl', role: 'admin', nss: VALID_NSS }), PROFILE()])
    await call({ nss: '' })
    expect(updates(state.db)[0].payload).toEqual({ nss: null })
  })

  test('un NSS con dígito verificador malo y un nombre vacío son errores que no escriben', async () => {
    state.db = table()
    expect((await call({ nss: '12345678900' })).isError).toBe(true)
    expect((await call({ nombre: '   ' })).isError).toBe(true)
    expect(updates(state.db)).toEqual([])
  })
})

describe('save_profile: lo de otra persona y lo sensible piden el sí', () => {
  test('la jornada de otra persona: la fase 1 avisa del efecto y no escribe; con la clave escribe', async () => {
    state.db = table()
    const { first, second, afterFirst } = await both({ persona: 'Diego', jornada: 'media' })
    expect(afterFirst).toBe(0)
    const one = parse(textOf(first))
    expect(one).toMatchObject({ accion: 'simulado', escrito: false, cambios: { jornada: { antes: 'completa', ahora: 'media' } } })
    expect(one.avisos).toEqual([expect.stringMatching(/jornada de nómina es otra \(save_payroll_employee\)/)])
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(updates(state.db).map((c) => c.payload)).toEqual([{ shift: 'part_time' }])
    expect(filterValue(updates(state.db)[0], 'id')).toBe(DIEGO)
  })

  test('hasta mi propio checador, jornada o área pide el sí', async () => {
    state.db = table()
    const { first, afterFirst } = await both({ area: 'taller' })
    expect(afterFirst).toBe(0)
    expect(parse(textOf(first))).toMatchObject({ accion: 'simulado', cambios: { area: { antes: 'oficina', ahora: 'taller' } } })
    expect(parse(textOf(first)).avisos).toEqual([expect.stringMatching(/sábado en Nómina.*cortes abiertos/)])
  })

  test('hasta el nombre de OTRA persona pide el sí', async () => {
    state.db = table()
    const { first, afterFirst } = await both({ persona: 'Diego', nombre: 'Diego Luis' })
    expect(afterFirst).toBe(0)
    expect(parse(textOf(first))).toMatchObject({ accion: 'simulado', escrito: false })
  })

  test('el id del checador: avisa del próximo import; uno que otra persona ya tiene es un bloqueo sin clave', async () => {
    state.db = table()
    const { first } = await both({ persona: 'Diego', id_checador: 7 })
    expect(parse(textOf(first)).avisos).toEqual([expect.stringMatching(/próximo reporte del checador asignará el id 7 a Diego/)])
    state.db = table([PROFILE({ id: ME, display_name: 'Axl', role: 'admin', clock_employee_id: 7 }), PROFILE()])
    const { first: blocked, second } = await both({ persona: 'Diego', id_checador: 7 })
    expect(parse(textOf(blocked)).bloqueos).toEqual(['El id 7 del checador ya lo tiene Axl.'])
    expect(parse(textOf(blocked))).not.toHaveProperty('clave')
    expect(second).toBeNull()
    expect(updates(state.db)).toEqual([])
  })

  test('null quita el checador y avisa que queda sin perfil en el próximo reporte', async () => {
    state.db = table()
    const { first, second } = await both({ persona: 'Diego', id_checador: null })
    expect(parse(textOf(first)).avisos).toEqual([expect.stringMatching(/sin perfil/)])
    expect(second?.isError).toBeFalsy()
    expect(updates(state.db)[0].payload).toEqual({ clock_employee_id: null })
  })

  test('REGLA: nunca rol ni tarifa; un campo desconocido es error y no escribe', async () => {
    state.db = table()
    for (const args of [{ persona: 'Diego', rol: 'administrador' }, { persona: 'Diego', tarifa: 90 }, { persona: 'Diego', hourly_rate: 90 }, { persona: 'Diego', role: 'admin' }]) {
      const result = await call(args)
      expect(result.isError, JSON.stringify(args)).toBe(true)
    }
    expect(updates(state.db)).toEqual([])
    expect(state.db.callsTo('profile_pay')).toEqual([])
    const mcp = await connectMcp('admin')
    try {
      const tool = (await mcp.tools()).find((t) => t.name === 'save_profile')
      expect(Object.keys(tool?.inputSchema.properties ?? {}).sort()).toEqual(['area', 'clave', 'id_checador', 'jornada', 'nombre', 'nss', 'persona'])
    } finally {
      await mcp.close()
    }
  })

  test('el nombre exacto gana: «Diego» llega a Diego aunque exista «Diego Luis»; sin exacto, varias coincidencias piden precisar', async () => {
    state.db = table([AXL, PROFILE(), PROFILE({ id: '33333333-3333-4333-8333-333333333333', display_name: 'Diego Luis', clock_employee_id: 9 })])
    const { first } = await both({ persona: 'diego', area: 'taller' })
    expect(parse(textOf(first)).persona).toMatchObject({ nombre: 'Diego' })
    const ambiguous = await call({ persona: 'dieg', area: 'taller' })
    expect(textOf(ambiguous)).toMatch(/2 coincidencias.*\[ref/)
  })

  test('una persona que no existe lo dice; sin cambios reales responde sin_cambios', async () => {
    state.db = table()
    expect(textOf(await call({ persona: 'Nadie', area: 'taller' }))).toMatch(/Ninguna persona visible/)
    expect(parse(textOf(await call({ persona: 'Diego', area: 'oficina', jornada: 'completa' }))).accion).toBe('sin_cambios')
    expect((await call({ persona: 'Diego' })).isError).toBe(true)
    expect(updates(state.db)).toEqual([])
  })

  test('la fase 1 sola nunca escribe y la clave repetida después de escribir no escribe otra vez', async () => {
    state.db = table()
    const mcp = await connectMcp('admin', authAs('admin', ME))
    try {
      await mcp.call('save_profile', { persona: 'Diego', area: 'taller' })
      expect(updates(state.db)).toEqual([])
      const first = parse(textOf(await mcp.call('save_profile', { persona: 'Diego', area: 'taller' })))
      await mcp.call('save_profile', { persona: 'Diego', area: 'taller', clave: first.clave })
      const again = await mcp.call('save_profile', { persona: 'Diego', area: 'taller', clave: first.clave })
      expect(parse(textOf(again))).toMatchObject({ accion: 'sin_cambios', escrito: false })
    } finally {
      await mcp.close()
    }
    expect(updates(state.db)).toHaveLength(1)
  })

  test('la huella: si cambió la persona entre el resumen y el sí, no escribe', async () => {
    state.db = table()
    const mcp = await connectMcp('admin', authAs('admin', ME))
    let after: MockSupabaseClient
    try {
      const first = parse(textOf(await mcp.call('save_profile', { persona: 'Diego', area: 'taller' })))
      after = state.db = table([AXL, PROFILE({ shift: 'part_time', updated_at: '2026-10-05T10:00:00Z' })])
      const second = await mcp.call('save_profile', { persona: 'Diego', area: 'taller', clave: first.clave })
      expect(textOf(second)).toBe('El perfil de Diego cambió desde el resumen: vuelve a pedirlo. No escribí nada.')
    } finally {
      await mcp.close()
    }
    expect(updates(after)).toEqual([])
  })

  test('sin MCP_PREVIEW_SECRET lo propio sigue directo y lo demás falla cerrado; un member ni la recibe', async () => {
    state.db = table()
    vi.stubEnv('MCP_PREVIEW_SECRET', '')
    expect(parse(textOf(await call({ nombre: 'Axl G' }))).accion).toBe('actualizado')
    const closed = await call({ persona: 'Diego', jornada: 'media' })
    expect(closed.isError).toBe(true)
    expect(textOf(closed)).toMatch(/todavía no está activada/)
    const member = await connectMcp('member')
    try {
      expect((await member.tools()).map((t) => t.name)).not.toContain('save_profile')
    } finally {
      await member.close()
    }
    expect(updates(state.db)).toHaveLength(1)
  })
})
