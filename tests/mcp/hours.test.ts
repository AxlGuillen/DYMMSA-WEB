/** MCP hours tools (#101): "me" comes from the token, everything else from RLS — the mock plays the policy. */

import { describe, test, expect } from 'vitest'
import { todayInMexico } from '@/lib/format'
import { weekBounds } from '@/lib/timesheet'
import { createMockSupabase, filterValue, type CallRecord } from '../helpers/supabase-mock'
import { ToolError, type Db } from '@/lib/mcp/shared'
import { getWeekHours, getHoursTrend, listTimeImports, previewTimeReport, saveTimeEntries, saveExcusedDay } from '@/lib/mcp/tools/hours'
import { NGTECO_PERIOD, NGTECO_WEEK } from '../helpers/fixtures/ngteco'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

const ME = { id: 'u-tania', display_name: 'Tania', shift: 'part_time' }
const DIEGO = { id: 'u-diego', display_name: 'Diego', shift: 'full_time' }

/** profiles as RLS serves them: a member gets only their row, an admin the whole team. */
function profiles(visible: typeof ME[]) {
  return (rec: CallRecord) => {
    const id = filterValue(rec, 'id')
    if (id) {
      const row = visible.find((p) => p.id === id) ?? null
      return { data: row, error: row ? null : { code: 'PGRST116' } }
    }
    const like = rec.filters.find((f) => f.method === 'ilike')?.args[1] as string | undefined
    const needle = like?.replace(/%/g, '').toLowerCase() ?? ''
    return { data: visible.filter((p) => p.display_name.toLowerCase().includes(needle)), error: null }
  }
}

const entry = (user_id: string, work_date: string, clock_in: string, clock_out: string | null) => ({
  id: `${user_id}-${work_date}-${clock_in}`, user_id, work_date, source_clock_in: clock_in, clock_in, clock_out,
  note: null, source: 'import', edited_by: null, edited_at: null, original: null, created_at: '', updated_at: '',
})

describe('get_week_hours', () => {
  test('member sin persona: sus propias checadas, total y cumplimiento contra 20 h', async () => {
    const client = createMockSupabase({
      responses: {
        'profiles.select': profiles([ME]),
        'time_entries.select': { data: [entry('u-tania', '2026-08-31', '09:00', '13:00'), entry('u-tania', '2026-09-01', '09:00', null)], error: null },
      },
    })
    const result = await getWeekHours(asDb(client), 'u-tania', { fecha: '2026-09-02' })

    expect(result.persona).toBe('Tania')
    expect(result.semana).toEqual({ inicio: '2026-08-31', fin: '2026-09-06' })
    expect(result.total).toBe('04:00')
    expect(result.sin_salida).toBe(1)
    expect(result).toMatchObject({ jornada: 'Medio tiempo · 4 h', objetivo_semanal_h: 20, cumplimiento_pct: 20, faltante: '16:00' })
    expect(result.dias[0]).toMatchObject({ dia: 'Lun', horas: '04:00', checadas: [{ entrada: '09:00', salida: '13:00' }] })
    // The read is scoped to the resolved person, never to whatever the model asked for.
    const read = client.callsTo('time_entries', 'select')[0]
    expect(filterValue(read, 'user_id')).toBe('u-tania')
  })

  test('admin con persona: resuelve por nombre parcial y lee a esa persona', async () => {
    const client = createMockSupabase({
      responses: { 'profiles.select': profiles([ME, DIEGO]), 'time_entries.select': { data: [], error: null } },
    })
    const result = await getWeekHours(asDb(client), 'u-tania', { persona: 'die' })
    expect(result.persona).toBe('Diego')
    expect(result).toMatchObject({ jornada: 'Tiempo completo · 8 h', objetivo_semanal_h: 40, total: '00:00' })
    expect(filterValue(client.callsTo('time_entries', 'select')[0], 'user_id')).toBe('u-diego')
  })

  test('un feriado del equipo baja el objetivo y cada día trae su estado (meeting 2026-10-01)', async () => {
    const client = createMockSupabase({
      responses: {
        'profiles.select': profiles([ME]),
        'time_entries.select': { data: [entry('u-tania', '2026-08-31', '09:00', '13:00'), entry('u-tania', '2026-09-01', '09:00', '11:00')], error: null },
        'excused_days.select': { data: [{ work_date: '2026-09-02', user_id: null, kind: 'holiday', note: null }], error: null },
      },
    })
    const result = await getWeekHours(asDb(client), 'u-tania', { fecha: '2026-09-02' })
    // Part time: 20 h − the holiday's 4 h = 16 h; worked 6 h.
    expect(result).toMatchObject({ objetivo_de_esta_semana: '16:00', faltante: '10:00' })
    expect(result.dias.slice(0, 3).map((d) => [d.estado, d.justificado])).toEqual([
      ['cumplió', null],
      ['no cumplió', null],
      ['justificado', 'Día feriado'],
    ])
    expect(client.callsTo('excused_days', 'select')[0].filters.find((f) => f.method === 'or')?.args[0]).toBe('user_id.is.null,user_id.eq.u-tania')
  })

  test('member que pregunta por otro: la RLS no le devuelve el perfil → error claro, sin leer checadas', async () => {
    const client = createMockSupabase({ responses: { 'profiles.select': profiles([ME]) } })
    await expect(getWeekHours(asDb(client), 'u-tania', { persona: 'Diego' })).rejects.toThrow(/Un miembro solo puede consultar lo suyo/)
    expect(client.callsTo('time_entries', 'select')).toHaveLength(0)
  })

  test('varias coincidencias piden precisar; fecha inválida → error', async () => {
    const client = createMockSupabase({
      responses: { 'profiles.select': profiles([ME, DIEGO, { id: 'u-d2', display_name: 'Diana', shift: null }]) },
    })
    await expect(getWeekHours(asDb(client), 'u-tania', { persona: 'di' })).rejects.toThrow(/2 coincidencias/)

    const many = Array.from({ length: 6 }, (_, i) => ({ id: `u-${i}`, display_name: `Diego ${i}`, shift: null }))
    const crowded = createMockSupabase({ responses: { 'profiles.select': profiles(many) } })
    await expect(getWeekHours(asDb(crowded), 'u-tania', { persona: 'diego' })).rejects.toThrow(/más de 5 coincidencias .*…/)
    await expect(getWeekHours(asDb(client), 'u-tania', { fecha: '02/09/2026' })).rejects.toThrow(ToolError)
    await expect(getWeekHours(asDb(client), 'u-tania', { fecha: '2026-02-30' })).rejects.toThrow(/Fecha inválida/)
  })

  test('sin jornada asignada no hay objetivo ni porcentaje', async () => {
    const client = createMockSupabase({
      responses: { 'profiles.select': profiles([{ id: 'u-x', display_name: 'Canales', shift: null }]), 'time_entries.select': { data: [], error: null } },
    })
    const result = await getWeekHours(asDb(client), 'u-x')
    expect(result).toMatchObject({ jornada: null, objetivo_semanal_h: null, cumplimiento_pct: null, faltante: null })
  })
})

describe('get_hours_trend', () => {
  test('N semanas hasta la actual, promedio y rango de lectura de N semanas', async () => {
    const client = createMockSupabase({
      responses: { 'profiles.select': profiles([ME]), 'time_entries.select': { data: [], error: null } },
    })
    const result = await getHoursTrend(asDb(client), 'u-tania', { semanas: 4 })
    expect(result.semanas).toBe(4)
    expect(result.por_semana).toHaveLength(4)
    expect(result.promedio_semanal).toBe('00:00')
    expect(result).toMatchObject({ cumplimiento_promedio_pct: 0, faltante_promedio: '20:00', semanas_con_registro: 0 })
    expect('cumplimiento_pct' in result).toBe(false)
    const read = client.callsTo('time_entries', 'select')[0]
    const from = read.filters.find((f) => f.method === 'gte')?.args[1] as string
    const to = read.filters.find((f) => f.method === 'lte')?.args[1] as string
    expect(result.por_semana[0].inicio).toBe(from)
    expect(result.por_semana[3].fin).toBe(to)
  })

  test('la tendencia descuenta los días justificados: objetivo por semana y cumplimiento contra él', async () => {
    const monday = weekBounds(todayInMexico()).start
    const client = createMockSupabase({
      responses: {
        'profiles.select': profiles([ME]),
        'time_entries.select': { data: [], error: null },
        'excused_days.select': { data: [{ work_date: monday, user_id: null, kind: 'holiday', note: null }], error: null },
      },
    })
    const result = await getHoursTrend(asDb(client), 'u-tania', { semanas: 1 })
    // Part time: 20 h a week, minus the 4 h of the holiday.
    expect(result.por_semana[0]).toMatchObject({ objetivo: '16:00', dias_justificados: 1 })
    expect(result.faltante_promedio).toBe('16:00')
  })

  test('semanas se acota a 1..26', async () => {
    const client = createMockSupabase({
      responses: { 'profiles.select': profiles([ME]), 'time_entries.select': { data: [], error: null } },
    })
    expect((await getHoursTrend(asDb(client), 'u-tania', { semanas: 99 })).semanas).toBe(26)
    expect((await getHoursTrend(asDb(client), 'u-tania', { semanas: 0 })).semanas).toBe(1)
  })
})

describe('list_time_imports', () => {
  test('lista las cargas más recientes primero', async () => {
    const client = createMockSupabase({
      responses: {
        'time_imports.select': {
          data: [{ period_start: '2026-08-31', period_end: '2026-09-06', file_name: 'NGTimereport.xls', inserted: 20, updated: 2, skipped_edited: 1, created_at: '2026-09-07T10:00:00Z' }],
          error: null,
        },
      },
    })
    const result = await listTimeImports(asDb(client), { limit: 5 })
    expect(result.nota).toBeNull()
    expect(result.cargas[0]).toMatchObject({ periodo: { inicio: '2026-08-31', fin: '2026-09-06' }, insertadas: 20, saltadas_por_edicion: 1 })
    const read = client.callsTo('time_imports', 'select')[0]
    expect(read.filters.find((f) => f.method === 'order')?.args).toEqual(['created_at', { ascending: false }])
    expect(read.filters.find((f) => f.method === 'limit')?.args).toEqual([5])
  })

  test('cero filas (lo que la RLS da a un member) se explica, no se calla', async () => {
    const client = createMockSupabase({ responses: { 'time_imports.select': { data: [], error: null } } })
    const result = await listTimeImports(asDb(client))
    expect(result.cargas).toEqual([])
    expect(result.nota).toMatch(/solo la ve un administrador/)
  })
})

describe('save_time_entries (#132)', () => {
  const MAPPED = [
    { id: 'u-diego', display_name: 'Diego', clock_employee_id: 1 },
    { id: 'u-tania', display_name: 'Tania', clock_employee_id: 5 },
    { id: 'u-santi', display_name: 'Santi', clock_employee_id: 2 },
  ]
  const importClient = (rpc: unknown = { data: { inserted: 5, updated: 0, skipped_edited: 0 }, error: null }) =>
    createMockSupabase({ responses: { 'profiles.select': { data: MAPPED, error: null }, 'rpc.import_time_entries': rpc } })

  test('las filas pasan por el parser de la app y la misma RPC; avisa quién no vino en el reporte', async () => {
    const client = importClient()
    const result = await saveTimeEntries(asDb(client), 'u-axl', { filas: NGTECO_WEEK, nombre_archivo: 'ASISTENCIA_OFICINA.xls' })

    expect(result.periodo).toEqual({ inicio: NGTECO_PERIOD.start, fin: NGTECO_PERIOD.end })
    expect(result).toMatchObject({ insertadas: 5, actualizadas: 0, saltadas_por_edicion: 0, sin_perfil: [], no_vinieron_en_el_reporte: ['Santi'] })
    expect(result.personas).toEqual([
      { nombre: 'Diego Baltazar', id_checador: 1, checadas: 4, sin_salida: 1 },
      { nombre: 'Tania', id_checador: 5, checadas: 2, sin_salida: 0 },
    ])
    const { fn, params } = client._rpcCalls[0] as { fn: string; params: Record<string, unknown> }
    expect(fn).toBe('import_time_entries')
    expect(params).toMatchObject({ p_period_start: '2026-08-31', p_period_end: '2026-09-06', p_file_name: 'Asistente (MCP): ASISTENCIA_OFICINA.xls' })
    expect(params.p_entries).toHaveLength(6)
  })

  test('si lo transcrito no cuadra con los totales del reporte no guarda nada y dice qué revisar', async () => {
    const client = importClient()
    const typo = NGTECO_WEEK.map((r) => (r[1] === '2026-08-31' && r[2] === '10:06' && r[3] === '18:27' ? ['LU', '2026-08-31', '10:06', '18:57', '08:21', '08:21'] : r))
    const err = await saveTimeEntries(asDb(client), 'u-axl', { filas: typo }).catch((e) => e)
    expect(err).toBeInstanceOf(ToolError)
    expect(err.message).toMatch(/No guardé nada/)
    expect(err.message).toMatch(/Diego Baltazar 2026-08-31 10:06–18:57: el reporte dice 08:21/)
    expect(client._rpcCalls).toEqual([])
    expect(client.callsTo('profiles')).toEqual([])
  })

  test('sin período, sin bloques o con la RLS diciendo no: error claro de la tool', async () => {
    await expect(saveTimeEntries(asDb(importClient()), 'u-axl', { filas: [] })).rejects.toThrow(/Manda las filas/)
    await expect(saveTimeEntries(asDb(importClient()), 'u-axl', { filas: NGTECO_WEEK.filter((r) => r[0] !== 'Período de pago') })).rejects.toThrow(/Período de pago/)
    const denied = importClient({ data: null, error: { code: '42501', message: 'denied' } })
    await expect(saveTimeEntries(asDb(denied), 'u-axl', { filas: NGTECO_WEEK })).rejects.toThrow(/Solo un administrador/)
  })
})

describe('save_time_entries con una checada (#134)', () => {
  const OPEN = { ...entry('u-diego', '2026-09-30', '09:02:00', null), original: null }

  test('corrige la salida de una checada: sella el rastro con quien corrige y conserva lo del checador', async () => {
    const client = createMockSupabase({
      responses: {
        'profiles.select': profiles([ME, DIEGO]),
        'time_entries.select': (rec: CallRecord) => ({ data: rec.single ? OPEN : [OPEN], error: null }),
        'time_entries.update': {
          data: { ...OPEN, clock_out: '18:00:00', edited_by: 'u-axl', original: { clock_in: '09:02', clock_out: null, note: null } },
          error: null,
        },
      },
    })
    const result = await saveTimeEntries(asDb(client), 'u-axl', { checada: { persona: 'die', fecha: '2026-09-30', entrada_actual: '9:02', salida: '18:00' } })

    expect(result).toEqual({
      accion: 'corregida', persona: 'Diego', fecha: '2026-09-30', entrada: '09:02', salida: '18:00', horas: '08:58', nota: null,
      lo_que_dijo_el_checador: { entrada: '09:02', salida: null },
    })
    const update = client.updatePayload('time_entries')
    expect(update).toMatchObject({ clock_out: '18:00', edited_by: 'u-axl', original: { clock_in: '09:02', clock_out: null, note: null } })
    expect(update).not.toHaveProperty('source_clock_in')
  })

  test('una entrada_actual que no existe ese día lista las checadas que sí hay, sin escribir', async () => {
    const client = createMockSupabase({
      responses: { 'profiles.select': profiles([ME, DIEGO]), 'time_entries.select': { data: [OPEN], error: null } },
    })
    await expect(saveTimeEntries(asDb(client), 'u-axl', { checada: { persona: 'Diego', fecha: '2026-09-30', entrada_actual: '10:00', salida: '18:00' } }))
      .rejects.toThrow(/no tiene una checada con entrada 10:00 .* Checadas de ese día: 09:02–sin salida/)
    expect(client.callsTo('time_entries', 'update')).toEqual([])
  })

  test('sin entrada_actual registra una checada manual para quien pregunta; valida antes de escribir', async () => {
    const client = createMockSupabase({
      responses: {
        'profiles.select': profiles([ME]),
        'time_entries.insert': { data: entry('u-tania', '2026-09-30', '09:00:00', '13:00:00'), error: null },
      },
    })
    const result = await saveTimeEntries(asDb(client), 'u-tania', { checada: { fecha: '2026-09-30', entrada: '9:00', salida: '13:00' } })
    expect(result).toMatchObject({ accion: 'registrada a mano', persona: 'Tania', horas: '04:00' })
    expect(client.insertPayload('time_entries')).toMatchObject({ user_id: 'u-tania', source: 'manual', source_clock_in: '09:00', clock_out: '13:00' })

    await expect(saveTimeEntries(asDb(client), 'u-tania', { checada: { fecha: '2026-09-30', entrada: '13:00', salida: '09:00' } })).rejects.toThrow(/antes de la entrada/)
    await expect(saveTimeEntries(asDb(client), 'u-tania', { checada: { fecha: '2026-02-30', entrada: '9:00' } })).rejects.toThrow(/Fecha inválida/)
    await expect(saveTimeEntries(asDb(client), 'u-tania', { checada: { fecha: '2026-09-30' } })).rejects.toThrow(/manda `entrada`/)
    await expect(saveTimeEntries(asDb(client), 'u-tania', { filas: NGTECO_WEEK, checada: { fecha: '2026-09-30', entrada: '9:00' } })).rejects.toThrow(/no las dos/)
    expect(client.callsTo('time_entries', 'insert')).toHaveLength(1)
  })
})

describe('save_excused_day (#134)', () => {
  test('sin persona marca el feriado para todo el equipo', async () => {
    const client = createMockSupabase({
      responses: { 'excused_days.select': { data: null, error: null }, 'excused_days.insert': { data: [{ id: 'new' }], error: null } },
    })
    const result = await saveExcusedDay(asDb(client), 'u-axl', { fecha: '2026-11-16', tipo: 'feriado', nota: 'Revolución' })
    expect(result).toMatchObject({ accion: 'marcado', tipo: 'Día feriado', para: 'todo el equipo', nota: 'Revolución' })
    expect(client.insertPayload('excused_days')).toEqual({ work_date: '2026-11-16', kind: 'holiday', user_id: null, note: 'Revolución' })
    expect(client.callsTo('excused_days', 'select')[0].filters).toContainEqual({ method: 'is', args: ['user_id', null] })
    expect(client.callsTo('profiles')).toEqual([])
  })

  test('con persona: si ya existe ese día lo actualiza conservando su nota; quitar lo borra', async () => {
    const existing = { id: 'x1', kind: 'holiday', note: 'cita médica' }
    const client = createMockSupabase({
      responses: {
        'profiles.select': profiles([ME, DIEGO]),
        'excused_days.select': { data: existing, error: null },
        'excused_days.update': { data: [{ id: 'x1' }], error: null },
        'excused_days.delete': { data: [{ id: 'x1' }], error: null },
      },
    })
    const result = await saveExcusedDay(asDb(client), 'u-axl', { fecha: '2026-10-01', tipo: 'salida_autorizada', persona: 'Diego' })
    expect(result).toMatchObject({ accion: 'actualizado', tipo: 'Salida autorizada', para: 'Diego', nota: 'cita médica' })
    expect(client.updatePayload('excused_days')).toEqual({ kind: 'early_release', note: 'cita médica' })
    expect(client.callsTo('excused_days', 'select')[0].filters).toContainEqual({ method: 'eq', args: ['user_id', 'u-diego'] })

    const removed = await saveExcusedDay(asDb(client), 'u-axl', { fecha: '2026-10-01', persona: 'Diego', quitar: true })
    expect(removed).toEqual({ accion: 'quitado', fecha: '2026-10-01', para: 'Diego', era: 'Día feriado' })
    expect(client.callsTo('excused_days', 'delete')[0].filters).toContainEqual({ method: 'eq', args: ['id', 'x1'] })
  })

  test('REGLA: si la RLS filtró la escritura a 0 filas no se reporta éxito (review PR #138)', async () => {
    const client = createMockSupabase({
      responses: {
        'excused_days.select': { data: { id: 'x1', kind: 'holiday', note: null }, error: null },
        'excused_days.update': { data: [], error: null },
        'excused_days.delete': { data: [], error: null },
      },
    })
    await expect(saveExcusedDay(asDb(client), 'u-axl', { fecha: '2026-11-16', tipo: 'salida_autorizada' })).rejects.toThrow(/Solo un administrador/)
    await expect(saveExcusedDay(asDb(client), 'u-axl', { fecha: '2026-11-16', quitar: true })).rejects.toThrow(/Solo un administrador/)
  })

  test('nuevo sin tipo, quitar uno que no existe o fecha inválida: error sin escribir', async () => {
    const client = createMockSupabase({ responses: { 'excused_days.select': { data: null, error: null } } })
    await expect(saveExcusedDay(asDb(client), 'u-axl', { fecha: '2026-11-16' })).rejects.toThrow(/Tipo inválido/)
    await expect(saveExcusedDay(asDb(client), 'u-axl', { fecha: '2026-11-16', quitar: true })).rejects.toThrow(/no está justificado para todo el equipo/)
    await expect(saveExcusedDay(asDb(client), 'u-axl', { fecha: '2026-02-30', tipo: 'feriado' })).rejects.toThrow(/Fecha inválida/)
    expect(client.callsTo('excused_days', 'insert')).toEqual([])
    expect(client.callsTo('excused_days', 'delete')).toEqual([])
  })
})

describe('preview_time_report (ADR-036)', () => {
  const MAPPED = [
    { id: 'u-tania', display_name: 'Tania', clock_employee_id: 5 },
    { id: 'u-santi', display_name: 'Santi', clock_employee_id: 2 },
  ]
  const client = () => createMockSupabase({ responses: { 'profiles.select': { data: MAPPED, error: null } } })

  test('arma la tabla por persona y día sin escribir nada; marca quién no tiene perfil y quién no vino', async () => {
    const db = client()
    const result = await previewTimeReport(asDb(db), { filas: NGTECO_WEEK, nombre_archivo: 'semana.xls' })

    expect(result).toMatchObject({ periodo: { inicio: '2026-08-31', fin: '2026-09-06' }, nombre_archivo: 'semana.xls', cuadra: true, problemas: [] })
    expect(result.dias.map((d) => d.dia)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'])
    const [diego, tania] = result.personas
    expect(diego).toMatchObject({ nombre: 'Diego Baltazar', perfil: null, total: '18:46', total_reporte: '18:46', cuadra: true })
    expect(diego.por_dia[1]).toEqual({ fecha: '2026-09-01', horas: '10:25', checadas: ['08:55–19:20', '19:21–19:21'], sin_salida: false })
    expect(diego.por_dia[3]).toMatchObject({ horas: '00:00', sin_salida: true })
    expect(diego.por_dia[2]).toMatchObject({ horas: null, checadas: [] })
    expect(tania).toMatchObject({ perfil: 'Tania', total: '16:47', total_reporte: '16:46', cuadra: true })
    expect(result.sin_perfil).toEqual(['Diego Baltazar (1)'])
    expect(result.no_vinieron_en_el_reporte).toEqual(['Santi'])
    expect(db._rpcCalls).toEqual([])
    expect(db._calls.filter((c) => c.op !== 'select')).toEqual([])
  })

  test('lo que no cuadra se marca por persona y en problemas, para que la vista no deje guardar', async () => {
    const typo = NGTECO_WEEK.map((r) => (r[1] === '2026-08-31' && r[3] === '18:27' ? ['LU', '2026-08-31', '10:06', '18:57', '08:21', '08:21'] : r))
    const result = await previewTimeReport(asDb(client()), { filas: typo })
    expect(result.cuadra).toBe(false)
    expect(result.personas.map((p) => p.cuadra)).toEqual([false, true])
    expect(result.problemas).toHaveLength(2)
    expect(result.siguiente_paso).toMatch(/No cuadra/)
    await expect(previewTimeReport(asDb(client()), { filas: NGTECO_WEEK.filter((r) => r[0] !== 'Período de pago') })).rejects.toThrow(/Período de pago/)
  })
})
