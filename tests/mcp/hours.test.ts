/** MCP hours tools (#101): "me" comes from the token, everything else from RLS — the mock plays the policy. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue, type CallRecord } from '../helpers/supabase-mock'
import { ToolError, type Db } from '@/lib/mcp/shared'
import { getWeekHours, getHoursTrend, listTimeImports } from '@/lib/mcp/tools/hours'

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

  test('member que pregunta por otro: la RLS no le devuelve el perfil → error claro, sin leer checadas', async () => {
    const client = createMockSupabase({ responses: { 'profiles.select': profiles([ME]) } })
    await expect(getWeekHours(asDb(client), 'u-tania', { persona: 'Diego' })).rejects.toThrow(/solo puede consultar sus propias horas/)
    expect(client.callsTo('time_entries', 'select')).toHaveLength(0)
  })

  test('varias coincidencias piden precisar; fecha inválida → error', async () => {
    const client = createMockSupabase({
      responses: { 'profiles.select': profiles([ME, DIEGO, { id: 'u-d2', display_name: 'Diana', shift: null }]) },
    })
    await expect(getWeekHours(asDb(client), 'u-tania', { persona: 'di' })).rejects.toThrow(/2 coincidencias/)
    await expect(getWeekHours(asDb(client), 'u-tania', { fecha: '02/09/2026' })).rejects.toThrow(ToolError)
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
    const read = client.callsTo('time_entries', 'select')[0]
    const from = read.filters.find((f) => f.method === 'gte')?.args[1] as string
    const to = read.filters.find((f) => f.method === 'lte')?.args[1] as string
    expect(result.por_semana[0].inicio).toBe(from)
    expect(result.por_semana[3].fin).toBe(to)
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
