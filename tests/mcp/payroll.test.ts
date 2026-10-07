/** MCP payroll tools (#123): the cut read and the draft-only write. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase } from '../helpers/supabase-mock'
import { type Db } from '@/lib/mcp/shared'
import { getPayrollPeriod, recordPayrollHours } from '@/lib/mcp/tools/payroll'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

const employee = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, profile_id: null, shift: 'full_time', active: true, created_at: '', updated_at: '', ...over,
})
const dayRow = (employeeId: string, date: string, minutes: number, over: Record<string, unknown> = {}) => ({
  id: `${employeeId}-${date}`, employee_id: employeeId, work_date: date, worked_minutes: minutes, missed_minutes: 0,
  note: null, source: 'sheet', status: 'confirmed', created_at: '', updated_at: '', ...over,
})

const TEAM = [employee('e1', 'Juan Pérez'), employee('e2', 'Juan Carlos Ruiz'), employee('e3', 'José Núñez'), employee('e4', 'Baja', { active: false })]

function writeClient(existing: unknown[] = [], closed: unknown[] = []) {
  return createMockSupabase({
    responses: {
      'payroll_employees.select': { data: TEAM, error: null },
      'payroll_days.select': { data: existing, error: null },
      'payroll_periods.select': { data: closed, error: null },
      'payroll_days.upsert': { data: null, error: null },
    },
  })
}

describe('get_payroll_period', () => {
  test('cualquier día del corte devuelve sábado→viernes con totales; los borradores no suman', async () => {
    const client = createMockSupabase({
      responses: {
        'payroll_employees.select': { data: TEAM, error: null },
        'payroll_days.select': {
          data: [dayRow('e1', '2026-09-19', 360), dayRow('e1', '2026-09-21', 690), dayRow('e3', '2026-09-22', 480, { status: 'draft' })],
          error: null,
        },
        'payroll_periods.select': { data: null, error: null },
      },
    })
    const result = await getPayrollPeriod(asDb(client), { fecha: '2026-09-23' })
    expect(result.corte).toEqual({ inicio: '2026-09-19', fin: '2026-09-25', cerrado: false, cerrado_por: null })
    expect(result.borradores).toBe(1)
    expect(result.nota).toBeNull()
    expect(result.empleados.map((e) => e.nombre)).toEqual(['Juan Pérez', 'Juan Carlos Ruiz', 'José Núñez'])
    expect(result.empleados[0]).toMatchObject({ normal: '08:00', extra: '03:30', sabado: '06:00', equivalente: '23:30', tipo: 'taller', jornada: 'Tiempo completo · 8 h' })
    expect(result.empleados[0].dias).toEqual([
      { dia: 'Sáb', fecha: '2026-09-19', horas: '06:00', no_trabajadas: null, estado: 'confirmado', origen: 'hoja', nota: null },
      { dia: 'Lun', fecha: '2026-09-21', horas: '11:30', no_trabajadas: null, estado: 'confirmado', origen: 'hoja', nota: null },
    ])
    expect(result.empleados[2]).toMatchObject({ equivalente: '00:00', dias: [{ estado: 'borrador' }] })
    expect(result.total.equivalente).toBe('23:30')
  })

  test('a un member la RLS le devuelve vacío: lo dice en vez de fingir un corte sin gente', async () => {
    const client = createMockSupabase({
      responses: { 'payroll_employees.select': { data: [], error: null }, 'payroll_days.select': { data: [], error: null }, 'payroll_periods.select': { data: null, error: null } },
    })
    const result = await getPayrollPeriod(asDb(client))
    expect(result.empleados).toEqual([])
    expect(result.nota).toMatch(/solo la ve un administrador/)
    await expect(getPayrollPeriod(asDb(client), { fecha: 'ayer' })).rejects.toThrow(/Fecha inválida/)
  })
})

describe('record_payroll_hours', () => {
  test('guarda como borrador de la hoja, en minutos, y reparte la hoja en sus dos cortes', async () => {
    const client = writeClient()
    const result = await recordPayrollHours(asDb(client), {
      dias: [
        { empleado: 'juan pérez', fecha: '2026-09-21', horas: 11.5 },
        { empleado: 'jose nunez', fecha: '2026-09-26', horas: 6, horas_no_trabajadas: 2, nota: 'medio turno' },
      ],
    })
    expect(client.upsertPayload('payroll_days')).toEqual([
      { employee_id: 'e1', work_date: '2026-09-21', worked_minutes: 690, missed_minutes: 0, note: null, source: 'sheet', status: 'draft' },
      { employee_id: 'e3', work_date: '2026-09-26', worked_minutes: 360, missed_minutes: 120, note: 'medio turno', source: 'sheet', status: 'draft' },
    ])
    expect(result).toMatchObject({
      guardados: 2,
      omitidos: [],
      cortes: [{ inicio: '2026-09-19', fin: '2026-09-25' }, { inicio: '2026-09-26', fin: '2026-10-02' }],
    })
    expect(result.nota).toMatch(/BORRADOR/)
  })

  test('nunca pisa lo confirmado, lo manual ni un corte cerrado: vuelven en omitidos con el motivo', async () => {
    const client = writeClient(
      [
        dayRow('e1', '2026-09-21', 480),
        dayRow('e1', '2026-09-22', 480, { source: 'manual', status: 'draft' }),
        dayRow('e1', '2026-09-23', 480, { status: 'draft', missed_minutes: 30, note: 'previa' }),
      ],
      [{ start_date: '2026-09-26' }],
    )
    const result = await recordPayrollHours(asDb(client), {
      dias: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-26'].map((fecha) => ({ empleado: 'Juan Pérez', fecha, horas: 9 })),
    })
    expect(result.guardados).toBe(1)
    expect(result.omitidos).toEqual([
      { empleado: 'Juan Pérez', fecha: '2026-09-21', motivo: 'ya está confirmado' },
      { empleado: 'Juan Pérez', fecha: '2026-09-22', motivo: 'se capturó a mano' },
      { empleado: 'Juan Pérez', fecha: '2026-09-26', motivo: 'el corte está cerrado' },
    ])
    // Re-reading the same sheet corrects its own draft and keeps what the call did not send.
    expect(client.upsertPayload('payroll_days')).toEqual([
      { employee_id: 'e1', work_date: '2026-09-23', worked_minutes: 540, missed_minutes: 30, note: 'previa', source: 'sheet', status: 'draft' },
    ])
  })

  test('el nombre exacto gana; ambiguo, desconocido o inactivo → error que guía, sin escribir nada', async () => {
    const client = writeClient()
    const one = (empleado: string) => recordPayrollHours(asDb(client), { dias: [{ empleado, fecha: '2026-09-21', horas: 8 }] })
    await expect(one('juan')).rejects.toThrow(/2 coincidencias \(Juan Pérez, Juan Carlos Ruiz\)/)
    await expect(one('Pedro')).rejects.toThrow(/No hay empleado de nómina que coincida con "Pedro"/)
    await expect(one('Baja')).rejects.toThrow(/No hay empleado/)
    expect(client.callsTo('payroll_days', 'upsert')).toEqual([])

    await one('Juan Pérez')
    expect(client.upsertPayload('payroll_days')[0].employee_id).toBe('e1')
  })

  test('valida fechas, horas y duplicados antes de tocar la BD; sin empleados visibles lo explica', async () => {
    const client = writeClient()
    const call = (dias: { empleado: string; fecha: string; horas: number }[]) => recordPayrollHours(asDb(client), { dias })
    await expect(call([])).rejects.toThrow(/al menos un día/)
    await expect(call([{ empleado: 'José', fecha: '21/09/2026', horas: 8 }])).rejects.toThrow(/Fecha inválida/)
    await expect(call([{ empleado: 'José', fecha: '2026-09-21', horas: 30 }])).rejects.toThrow(/Horas inválidas/)
    await expect(call([{ empleado: 'José', fecha: '2026-09-21', horas: 8 }, { empleado: 'jose nunez', fecha: '2026-09-21', horas: 9 }])).rejects.toThrow(/viene repetido/)
    expect(client.callsTo('payroll_days', 'upsert')).toEqual([])

    // A 0-hour day never becomes a draft; with missed hours it is a real record (review PR #129).
    await expect(call([{ empleado: 'José', fecha: '2026-09-21', horas: 0 }])).rejects.toThrow(/un día sin horas no se carga/)
    expect(client.callsTo('payroll_days', 'upsert')).toEqual([])
    await recordPayrollHours(asDb(client), { dias: [{ empleado: 'José', fecha: '2026-09-21', horas: 0, horas_no_trabajadas: 8 }] })
    expect(client.upsertPayload('payroll_days')[0]).toMatchObject({ worked_minutes: 0, missed_minutes: 480 })

    const member = createMockSupabase({ responses: { 'payroll_employees.select': { data: [], error: null } } })
    await expect(recordPayrollHours(asDb(member), { dias: [{ empleado: 'José', fecha: '2026-09-21', horas: 8 }] })).rejects.toThrow(/solo la ve un administrador/)
  })
})

describe('record_payroll_hours con traer_de_horas (#132)', () => {
  test('copia las checadas de la oficina al corte de la fecha como borrador, igual que el botón', async () => {
    const office = employee('e9', 'Tania', { profile_id: 'u-tania' })
    const client = createMockSupabase({
      responses: {
        'payroll_employees.select': { data: [...TEAM, office], error: null },
        'time_entries.select': {
          data: [
            { user_id: 'u-tania', work_date: '2026-09-21', source_clock_in: '09:00', clock_in: '09:00', clock_out: '13:00' },
            { user_id: 'u-tania', work_date: '2026-09-22', source_clock_in: '09:00', clock_in: '09:00', clock_out: null },
            { user_id: 'u-tania', work_date: '2026-09-23', source_clock_in: '09:00', clock_in: '09:00', clock_out: '13:00' },
          ],
          error: null,
        },
        'payroll_days.select': { data: [dayRow('e9', '2026-09-23', 240, { source: 'manual', status: 'draft' })], error: null },
        'payroll_periods.select': { data: [], error: null },
        'payroll_days.upsert': { data: null, error: null },
        'payroll_days.delete': { data: null, error: null },
      },
    })
    const result = await recordPayrollHours(asDb(client), { traer_de_horas: true, fecha: '2026-09-23' })

    expect(result).toMatchObject({
      corte: { inicio: '2026-09-19', fin: '2026-09-25' },
      empleados_ligados: 1,
      guardados: 1,
      checadas_sin_salida: 1,
      omitidos: [{ empleado: 'Tania', fecha: '2026-09-23', motivo: 'se capturó a mano' }],
    })
    expect(client.upsertPayload('payroll_days').map((r) => [r.work_date, r.worked_minutes, r.source, r.status])).toEqual([
      ['2026-09-21', 240, 'hours', 'draft'],
    ])
  })

  test('sin nadie ligado lo explica; dias y traer_de_horas juntos, o fecha sin traer, se rechazan', async () => {
    const result = await recordPayrollHours(asDb(writeClient()), { traer_de_horas: true, fecha: '2026-09-23' })
    expect(result).toMatchObject({ empleados_ligados: 0, guardados: 0, nota: expect.stringMatching(/ligado a un perfil/) })

    const client = writeClient()
    await expect(recordPayrollHours(asDb(client), { traer_de_horas: true, dias: [{ empleado: 'José', fecha: '2026-09-21', horas: 8 }] })).rejects.toThrow(/no los dos/)
    await expect(recordPayrollHours(asDb(client), { fecha: '2026-09-21', dias: [{ empleado: 'José', fecha: '2026-09-21', horas: 8 }] })).rejects.toThrow(/solo aplica con/)
    await expect(recordPayrollHours(asDb(client), { traer_de_horas: true, fecha: '2026-02-30' })).rejects.toThrow(/Fecha inválida/)
    expect(client.callsTo('payroll_days', 'upsert')).toEqual([])
  })
})
