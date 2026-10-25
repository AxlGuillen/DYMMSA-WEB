/** save_payroll_period and save_payroll_hours.corregir (#155 D, ADR-033 §9 reopened) through the real SDK: always the yes. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CallRecord, MockSupabaseClient } from '../helpers/supabase-mock'

const state = vi.hoisted(() => ({ db: null as unknown as MockSupabaseClient }))

vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => state.db), verifierClient: vi.fn() }))

import { createMockSupabase, filterValue } from '../helpers/supabase-mock'
import { authAs, connectMcp, textOf } from './harness'
import { TEST_PREVIEW_SECRET } from '../helpers/preview-secret'

const SAT = '2026-09-19'
const TUE = '2026-09-22'
const employee = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, profile_id: null, shift: 'full_time', active: true, created_at: '', updated_at: '', ...over,
})
const day = (employeeId: string, date: string, minutes: number, over: Record<string, unknown> = {}) => ({
  id: `d-${employeeId}-${date}`, employee_id: employeeId, work_date: date, worked_minutes: minutes, missed_minutes: 0, note: null,
  source: 'sheet', status: 'draft', shift_snapshot: null, area_snapshot: null, created_at: '', updated_at: '2026-09-20T10:00:00Z', ...over,
})
const TEAM = [employee('e1', 'Juan Pérez'), employee('e2', 'Pedro Gómez'), employee('e3', 'Luis Baja', { active: false })]
const OPEN = null
const CLOSED = { start_date: SAT, status: 'closed', closed_at: '2026-09-26T20:00:00Z', closed_by_name: 'Tania', reopened_at: null, reopened_by_name: null }

const parse = (text: string) => JSON.parse(text) as Record<string, unknown>

beforeEach(() => {
  vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
})
afterEach(() => vi.unstubAllEnvs())

/** The three payroll tables, kept in memory so the writes show in the next read. */
function world({ days = [], period = OPEN, employees = TEAM }: { days?: ReturnType<typeof day>[]; period?: typeof CLOSED | null; employees?: typeof TEAM } = {}) {
  const table = [...days]
  let periodRow = period
  let clock = 0
  return createMockSupabase({
    responses: {
      'payroll_employees.select': { data: employees, error: null },
      'payroll_days.select': () => ({ data: table, error: null }),
      'payroll_periods.select': (rec: CallRecord) => ({ data: rec.single ? periodRow : periodRow?.status === 'closed' ? [periodRow] : [], error: null }),
      'profiles.select': (rec: CallRecord) => (rec.single ? { data: { display_name: 'Axl' }, error: null } : { data: [], error: null }),
      'payroll_days.update': (rec: CallRecord) => {
        const ids = (rec.filters.find((f) => f.method === 'in')?.args[1] as string[] | undefined) ?? table.map((d) => d.id)
        const hit = table.filter((d) => d.status === 'draft' && ids.includes(d.id))
        for (const d of hit) Object.assign(d, rec.payload, { updated_at: `2026-09-27T10:00:0${++clock}Z` })
        return { data: hit.map((d) => ({ id: d.id })), error: null }
      },
      'payroll_days.upsert': (rec: CallRecord) => {
        for (const row of rec.payload as ReturnType<typeof day>[]) {
          const i = table.findIndex((d) => d.employee_id === row.employee_id && d.work_date === row.work_date)
          const next = { ...day(row.employee_id, row.work_date, 0), ...(i >= 0 ? table[i] : {}), ...row, updated_at: `2026-09-27T10:00:0${++clock}Z` }
          if (i >= 0) table[i] = next
          else table.push(next)
        }
        return { data: null, error: null }
      },
      'payroll_days.delete': (rec: CallRecord) => {
        const at = table.findIndex((d) => d.employee_id === filterValue(rec, 'employee_id') && d.work_date === filterValue(rec, 'work_date'))
        if (at >= 0) table.splice(at, 1)
        return { data: null, error: null }
      },
      'rpc.close_payroll_period': () => {
        periodRow = { ...CLOSED, closed_by_name: 'Axl' }
        return { data: periodRow, error: null }
      },
      'rpc.reopen_payroll_period': () => {
        periodRow = null
        return { data: { ...CLOSED, status: 'open', reopened_by_name: 'Axl' }, error: null }
      },
    },
  })
}

async function open() {
  return connectMcp('admin', authAs('admin', 'admin-1'))
}

/** Phase 1, then the yes with the key; `afterFirst` counts what phase 1 had written when the yes arrived. */
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

const writes = (db: MockSupabaseClient) => db._calls.filter((c) => c.op !== 'select')

describe('save_payroll_period: confirmar_borradores', () => {
  const drafts = () => [day('e1', SAT, 300), day('e1', TUE, 690), day('e2', TUE, 480, { source: 'hours' }), day('e2', '2026-09-23', 480, { status: 'confirmed', source: 'manual' })]

  test('la fase 1 lista cada día que pasa a ser pagable y el efecto en el total, sin escribir; con la clave confirma exactamente esos', async () => {
    state.db = world({ days: drafts() })
    const { first, second, afterFirst } = await both('save_payroll_period', { accion: 'confirmar_borradores', fecha: TUE })
    expect(afterFirst).toBe(0)
    const one = parse(textOf(first))
    expect(one).toMatchObject({ accion: 'simulado', escrito: false })
    const shown = (one.corte as { por_confirmar: { empleado: string; fecha: string; horas: string; origen: string }[] }).por_confirmar
    expect(shown).toHaveLength(3)
    expect(shown).toEqual(
      expect.arrayContaining([
        { empleado: 'Juan Pérez', fecha: SAT, horas: '05:00', origen: 'hoja' },
        { empleado: 'Juan Pérez', fecha: TUE, horas: '11:30', origen: 'hoja' },
        { empleado: 'Pedro Gómez', fecha: TUE, horas: '08:00', origen: 'checador' },
      ]),
    )
    expect(one.avisos).toEqual([expect.stringMatching(/^Se confirman 3 días en borrador/), 'Total equivalente del corte: 08:00 → 32:30.'])
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(parse(textOf(second!))).toMatchObject({ accion: 'actualizado', escrito: true, corte: { confirmados: 3 } })
    const update = state.db.callsTo('payroll_days', 'update')[0]
    expect(update.payload).toEqual({ status: 'confirmed' })
    expect(update.filters.find((f) => f.method === 'in')?.args[1]).toEqual(expect.arrayContaining([`d-e1-${SAT}`, `d-e1-${TUE}`, `d-e2-${TUE}`]))
    expect(update.filters.find((f) => f.method === 'in')?.args[1]).toHaveLength(3)
  })

  test('REGLA: la clave se ata al conjunto de borradores: uno nuevo o uno cambiado entre el resumen y el sí anula la confirmación', async () => {
    for (const mutate of [
      (days: ReturnType<typeof day>[]) => [...days, day('e1', '2026-09-24', 480)],
      (days: ReturnType<typeof day>[]) => days.map((d) => (d.id === `d-e1-${TUE}` ? { ...d, worked_minutes: 600, updated_at: '2026-09-25T10:00:00Z' } : d)),
      (days: ReturnType<typeof day>[]) => days.filter((d) => d.id !== `d-e1-${SAT}`),
    ]) {
      state.db = world({ days: drafts() })
      const mcp = await open()
      let after: MockSupabaseClient
      try {
        const first = parse(textOf(await mcp.call('save_payroll_period', { accion: 'confirmar_borradores', fecha: TUE })))
        after = state.db = world({ days: mutate(drafts()) })
        const second = await mcp.call('save_payroll_period', { accion: 'confirmar_borradores', fecha: TUE, clave: first.clave })
        expect(second.isError).toBe(true)
        expect(textOf(second)).toBe(`El corte del ${SAT} al 2026-09-25 cambió desde el resumen: vuelve a pedirlo. No escribí nada.`)
      } finally {
        await mcp.close()
      }
      expect(writes(after)).toEqual([])
    }
  })

  test('sin borradores responde sin_cambios, sin clave; la clave repetida después de confirmar no escribe otra vez', async () => {
    state.db = world({ days: [day('e1', TUE, 480, { status: 'confirmed' })] })
    const { first } = await both('save_payroll_period', { accion: 'confirmar_borradores', fecha: TUE })
    expect(parse(textOf(first))).toMatchObject({ accion: 'sin_cambios', escrito: false })
    expect(parse(textOf(first))).not.toHaveProperty('clave')

    state.db = world({ days: drafts() })
    const mcp = await open()
    try {
      const key = parse(textOf(await mcp.call('save_payroll_period', { accion: 'confirmar_borradores', fecha: TUE }))).clave
      await mcp.call('save_payroll_period', { accion: 'confirmar_borradores', fecha: TUE, clave: key })
      const again = await mcp.call('save_payroll_period', { accion: 'confirmar_borradores', fecha: TUE, clave: key })
      expect(parse(textOf(again))).toMatchObject({ accion: 'sin_cambios', escrito: false })
    } finally {
      await mcp.close()
    }
    expect(state.db.callsTo('payroll_days', 'update')).toHaveLength(1)
  })
})

describe('save_payroll_period: cerrar y reabrir', () => {
  test('cerrar con borradores es un bloqueo sin clave', async () => {
    state.db = world({ days: [day('e1', TUE, 480)] })
    const { first, second } = await both('save_payroll_period', { accion: 'cerrar', fecha: TUE })
    expect(parse(textOf(first)).bloqueos).toEqual(['Hay 1 días en borrador: confírmalos (confirmar_borradores) o bórralos antes de cerrar.'])
    expect(parse(textOf(first))).not.toHaveProperty('clave')
    expect(second).toBeNull()
    expect(writes(state.db)).toEqual([])
  })

  test('cerrar muestra el total por empleado; con la clave llama a la RPC con el nombre de quien lo pide', async () => {
    state.db = world({ days: [day('e1', TUE, 690, { status: 'confirmed' }), day('e2', TUE, 480, { status: 'confirmed' })] })
    const { first, second, afterFirst } = await both('save_payroll_period', { accion: 'cerrar', fecha: TUE })
    expect(afterFirst).toBe(0)
    expect(parse(textOf(first)).corte).toMatchObject({
      estado: 'abierto',
      empleados: [{ nombre: 'Juan Pérez', equivalente: '11:30' }, { nombre: 'Pedro Gómez', equivalente: '08:00' }],
      total_equivalente: '19:30',
    })
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(parse(textOf(second!))).toMatchObject({ accion: 'actualizado', escrito: true, corte: { estado: 'cerrado' } })
    expect(state.db.rpcParams('close_payroll_period')).toEqual([{ p_start: SAT, p_actor_name: 'Axl' }])
  })

  test('un corte ya cerrado no se vuelve a cerrar (sin_cambios); reabrir uno abierto tampoco', async () => {
    state.db = world({ period: CLOSED })
    expect(parse(textOf((await both('save_payroll_period', { accion: 'cerrar', fecha: TUE })).first))).toMatchObject({ accion: 'sin_cambios', avisos: [expect.stringMatching(/lo cerró Tania/)] })
    state.db = world()
    expect(parse(textOf((await both('save_payroll_period', { accion: 'reabrir', fecha: TUE })).first)).accion).toBe('sin_cambios')
    expect(state.db._rpcCalls).toEqual([])
  })

  test('reabrir avisa que puede estar pagado y llama a la RPC; la clave repetida después ya no escribe', async () => {
    state.db = world({ period: CLOSED })
    const mcp = await open()
    try {
      const first = parse(textOf(await mcp.call('save_payroll_period', { accion: 'reabrir', fecha: TUE })))
      expect(first.corte).toMatchObject({ estado: 'cerrado', cerrado_por: 'Tania' })
      expect(first.avisos).toEqual([expect.stringMatching(/ya pagado|ya estar pagado|puede estar ya pagado/)])
      expect(state.db._rpcCalls).toEqual([])
      await mcp.call('save_payroll_period', { accion: 'reabrir', fecha: TUE, clave: first.clave })
      const again = await mcp.call('save_payroll_period', { accion: 'reabrir', fecha: TUE, clave: first.clave })
      expect(parse(textOf(again)).accion).toBe('sin_cambios')
    } finally {
      await mcp.close()
    }
    expect(state.db.rpcParams('reopen_payroll_period')).toEqual([{ p_start: SAT, p_actor_name: 'Axl' }])
  })

  test('una acción que no existe y una fecha inventada son errores; sin MCP_PREVIEW_SECRET falla cerrado; un member ni la recibe', async () => {
    state.db = world()
    const mcp = await open()
    try {
      expect((await mcp.call('save_payroll_period', { accion: 'pagar' })).isError).toBe(true)
      expect(textOf(await mcp.call('save_payroll_period', { accion: 'cerrar', fecha: '2026-02-30' }))).toMatch(/fecha/i)
      vi.stubEnv('MCP_PREVIEW_SECRET', '')
      expect(textOf(await mcp.call('save_payroll_period', { accion: 'cerrar' }))).toMatch(/todavía no está activada/)
    } finally {
      await mcp.close()
    }
    const member = await connectMcp('member')
    try {
      expect((await member.tools()).map((t) => t.name)).not.toContain('save_payroll_period')
    } finally {
      await member.close()
    }
    expect(writes(state.db)).toEqual([])
  })
})

describe('save_payroll_hours.corregir', () => {
  const confirmed = (minutes: number, over: Record<string, unknown> = {}) => day('e2', TUE, minutes, { status: 'confirmed', source: 'manual', ...over })

  test('un día confirmado: la fase 1 dice antes → después y el efecto en el total; con la clave queda manual y confirmado', async () => {
    state.db = world({ days: [confirmed(480)] })
    const { first, second, afterFirst } = await both('save_payroll_hours', { corregir: { empleado: 'Pedro', fecha: TUE, horas: 9.5 } })
    expect(afterFirst).toBe(0)
    const one = parse(textOf(first))
    expect(one).toMatchObject({
      accion: 'simulado',
      escrito: false,
      dia: { empleado: 'Pedro Gómez', fecha: TUE, horas: '09:30', estado: 'confirmado', origen: 'manual' },
      cambios: { dia: { antes: { horas: '08:00', estado: 'confirmado' }, ahora: { horas: '09:30', estado: 'confirmado' } } },
    })
    expect(one.avisos).toEqual([expect.stringContaining('08:00 → 09:30')])
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(state.db.upsertPayload('payroll_days')).toEqual([
      { employee_id: 'e2', work_date: TUE, worked_minutes: 570, missed_minutes: 0, note: null, source: 'manual', status: 'confirmed' },
    ])
  })

  test('lo omitido se conserva (horas no trabajadas y nota); texto vacío borra la nota', async () => {
    state.db = world({ days: [confirmed(480, { missed_minutes: 60, note: 'salió temprano' })] })
    await both('save_payroll_hours', { corregir: { empleado: 'Pedro', fecha: TUE, horas: 9 } })
    expect(state.db.upsertPayload('payroll_days')).toMatchObject([{ missed_minutes: 60, note: 'salió temprano', worked_minutes: 540 }])
    state.db = world({ days: [confirmed(480, { note: 'salió temprano' })] })
    await both('save_payroll_hours', { corregir: { empleado: 'Pedro', fecha: TUE, horas: 8, nota: '' } })
    expect(state.db.upsertPayload('payroll_days')).toMatchObject([{ note: null }])
  })

  test('0 horas sin nota borra el día, como la celda vacía', async () => {
    state.db = world({ days: [confirmed(480, { note: 'x' })] })
    const { first, second } = await both('save_payroll_hours', { corregir: { empleado: 'Pedro', fecha: TUE, horas: 0 } })
    expect(parse(textOf(first)).avisos).toEqual([expect.stringMatching(/Se borra el día.*08:00 → 00:00/)])
    expect(parse(textOf(second!))).toMatchObject({ accion: 'borrado', escrito: true })
    expect(state.db.callsTo('payroll_days', 'delete')).toHaveLength(1)
    expect(state.db.callsTo('payroll_days', 'upsert')).toEqual([])
  })

  test('un borrador pasa a confirmado y lo avisa; borrar un día que no existe es sin_cambios', async () => {
    state.db = world({ days: [day('e2', TUE, 480)] })
    const { first } = await both('save_payroll_hours', { corregir: { empleado: 'Pedro', fecha: TUE, horas: 8 } })
    expect(parse(textOf(first)).avisos).toContain('Era un borrador: al corregirlo queda confirmado.')
    state.db = world()
    const none = await both('save_payroll_hours', { corregir: { empleado: 'Pedro', fecha: TUE, horas: 0 } })
    expect(parse(textOf(none.first)).accion).toBe('sin_cambios')
  })

  test('un empleado dado de baja se puede corregir; un corte cerrado es un bloqueo', async () => {
    state.db = world({ days: [day('e3', TUE, 480, { status: 'confirmed', source: 'manual' })] })
    const { first, second } = await both('save_payroll_hours', { corregir: { empleado: 'Baja', fecha: TUE, horas: 7 } })
    expect(parse(textOf(first)).dia).toMatchObject({ empleado: 'Luis Baja' })
    expect(second?.isError).toBeFalsy()

    state.db = world({ days: [confirmed(480)], period: CLOSED })
    const blocked = await both('save_payroll_hours', { corregir: { empleado: 'Pedro', fecha: TUE, horas: 9 } })
    expect(parse(textOf(blocked.first)).bloqueos).toEqual([expect.stringMatching(/está cerrado: reábrelo primero/)])
    expect(blocked.second).toBeNull()
    expect(writes(state.db)).toEqual([])
  })

  test('la huella: si alguien tocó ese día entre el resumen y el sí, no escribe', async () => {
    state.db = world({ days: [confirmed(480)] })
    const mcp = await open()
    let after: MockSupabaseClient
    try {
      const args = { corregir: { empleado: 'Pedro', fecha: TUE, horas: 9.5 } }
      const first = parse(textOf(await mcp.call('save_payroll_hours', args)))
      after = state.db = world({ days: [confirmed(600, { updated_at: '2026-09-25T10:00:00Z' })] })
      const second = await mcp.call('save_payroll_hours', { ...args, clave: first.clave })
      expect(textOf(second)).toBe(`El día ${TUE} de Pedro Gómez cambió desde el resumen: vuelve a pedirlo. No escribí nada.`)
    } finally {
      await mcp.close()
    }
    expect(writes(after)).toEqual([])
  })

  test('lo mismo que ya hay no se reescribe; la clave repetida después de escribir tampoco escribe otra vez', async () => {
    state.db = world({ days: [confirmed(480)] })
    expect(parse(textOf((await both('save_payroll_hours', { corregir: { empleado: 'Pedro', fecha: TUE, horas: 8 } })).first)).accion).toBe('sin_cambios')

    state.db = world({ days: [confirmed(480)] })
    const mcp = await open()
    try {
      const args = { corregir: { empleado: 'Pedro', fecha: TUE, horas: 10 } }
      const key = parse(textOf(await mcp.call('save_payroll_hours', args))).clave
      await mcp.call('save_payroll_hours', { ...args, clave: key })
      const again = await mcp.call('save_payroll_hours', { ...args, clave: key })
      expect(parse(textOf(again)).accion).toBe('sin_cambios')
    } finally {
      await mcp.close()
    }
    expect(state.db.callsTo('payroll_days', 'upsert')).toHaveLength(1)
  })

  test('una intención por llamada: corregir va solo; las horas inválidas y un empleado ambiguo son errores', async () => {
    state.db = world({ days: [confirmed(480)], employees: [...TEAM, employee('e9', 'Pedro Ruiz')] })
    const mcp = await open()
    try {
      const withDias = await mcp.call('save_payroll_hours', { corregir: { empleado: 'Pedro Gómez', fecha: TUE, horas: 9 }, dias: [{ empleado: 'Juan', fecha: TUE, horas: 8 }] })
      expect(textOf(withDias)).toMatch(/Una intención por llamada/)
      expect(textOf(await mcp.call('save_payroll_hours', { corregir: { empleado: 'Pedro', fecha: TUE, horas: 9 } }))).toMatch(/2 coincidencias/)
      expect((await mcp.call('save_payroll_hours', { corregir: { empleado: 'Pedro Gómez', fecha: TUE, horas: 30 } })).isError).toBe(true)
    } finally {
      await mcp.close()
    }
    expect(writes(state.db)).toEqual([])
  })

  test('la hoja (`dias`) y «Traer de Horas» siguen directas, sin clave ni MCP_PREVIEW_SECRET; corregir falla cerrado', async () => {
    state.db = world({ days: [confirmed(480)] })
    vi.stubEnv('MCP_PREVIEW_SECRET', '')
    const mcp = await open()
    try {
      const sheet = await mcp.call('save_payroll_hours', { dias: [{ empleado: 'Juan', fecha: '2026-09-23', horas: 8 }] })
      expect(parse(textOf(sheet))).toMatchObject({ accion: 'actualizado', escrito: true, horas: { guardados: 1 } })
      expect(state.db.upsertPayload('payroll_days')).toMatchObject([{ source: 'sheet', status: 'draft' }])
      const closed = await mcp.call('save_payroll_hours', { corregir: { empleado: 'Pedro', fecha: TUE, horas: 9 } })
      expect(textOf(closed)).toMatch(/todavía no está activada/)
    } finally {
      await mcp.close()
    }
  })
})
