/** MCP payroll tools (#123): the cut read and the draft-only write. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue, type CallRecord } from '../helpers/supabase-mock'
import { type Db } from '@/lib/mcp/shared'
import { getPayrollPeriod, recordPayrollHours, savePayrollEmployee } from '@/lib/mcp/tools/payroll'

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
    // Workshop Saturday of 6 h: 5 normal + 1 at double (#135).
    expect(result.empleados[0]).toMatchObject({ normal: '13:00', extra: '03:30', sabado_extra: '01:00', equivalente: '18:30', tipo: 'taller', jornada: 'Tiempo completo · 8 h' })
    expect(result.empleados[0].dias).toEqual([
      { dia: 'Sáb', fecha: '2026-09-19', horas: '06:00', no_trabajadas: null, estado: 'confirmado', origen: 'hoja', nota: null },
      { dia: 'Lun', fecha: '2026-09-21', horas: '11:30', no_trabajadas: null, estado: 'confirmado', origen: 'hoja', nota: null },
    ])
    expect(result.empleados[2]).toMatchObject({ equivalente: '00:00', dias: [{ estado: 'borrador' }] })
    expect(result.total.equivalente).toBe('18:30')
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
  test('copia las checadas de la oficina al corte de la fecha como borrador y paga su sábado, igual que el botón', async () => {
    const office = employee('e9', 'Tania', { profile_id: 'u-tania' })
    const client = createMockSupabase({
      responses: {
        'payroll_employees.select': { data: [...TEAM, office], error: null },
        'profiles.select': { data: [{ id: 'u-tania', area: 'office' }], error: null },
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
      guardados: 2,
      checadas_sin_salida: 1,
      sabados_oficina: 1,
      omitidos: [{ empleado: 'Tania', fecha: '2026-09-23', motivo: 'se capturó a mano' }],
    })
    // Her Saturday is paid without a punch (#135): 8 h as a draft, with a note that says why.
    expect(client.upsertPayload('payroll_days').map((r) => [r.work_date, r.worked_minutes, r.source, r.status, r.note])).toEqual([
      ['2026-09-19', 480, 'hours', 'draft', 'Sábado de oficina: se pagan 8 h'],
      ['2026-09-21', 240, 'hours', 'draft', null],
    ])
  })

  test('sin nadie ligado lo explica; dias y traer_de_horas juntos, o fecha sin traer, se rechazan', async () => {
    const result = await recordPayrollHours(asDb(writeClient()), { traer_de_horas: true, fecha: '2026-09-23' })
    expect(result).toMatchObject({ empleados_ligados: 0, guardados: 0, nota: expect.stringMatching(/ligado a un perfil/) })
    // A member reads zero employees: no access, not "nobody linked" (review PR #138).
    const member = createMockSupabase({ responses: { 'payroll_employees.select': { data: [], error: null } } })
    await expect(recordPayrollHours(asDb(member), { traer_de_horas: true })).rejects.toThrow(/solo la ve un administrador/)
    expect(member.callsTo('time_entries')).toEqual([])

    const client = writeClient()
    await expect(recordPayrollHours(asDb(client), { traer_de_horas: true, dias: [{ empleado: 'José', fecha: '2026-09-21', horas: 8 }] })).rejects.toThrow(/no los dos/)
    await expect(recordPayrollHours(asDb(client), { fecha: '2026-09-21', dias: [{ empleado: 'José', fecha: '2026-09-21', horas: 8 }] })).rejects.toThrow(/solo aplica con/)
    await expect(recordPayrollHours(asDb(client), { traer_de_horas: true, fecha: '2026-02-30' })).rejects.toThrow(/Fecha inválida/)
    expect(client.callsTo('payroll_days', 'upsert')).toEqual([])
  })
})

describe('save_payroll_employee (#134)', () => {
  const TANIA = { id: '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7', display_name: 'Tania López' }
  // resolvePerson reads a list by name; reading the linked name back is a .maybeSingle().
  const profiles = (rec: CallRecord) => (rec.single ? { data: { display_name: TANIA.display_name }, error: null } : { data: [TANIA], error: null })
  const echo = (rec: CallRecord) => ({ data: employee('new', 'x', rec.payload as Record<string, unknown>), error: null })

  test('alta con jornada y perfil ligado por nombre: mismo parser que la ruta', async () => {
    const client = createMockSupabase({ responses: { profiles, 'payroll_employees.insert': echo } })
    const result = await savePayrollEmployee(asDb(client), 'u-admin', { nombre: '  Pedro   Gómez ', jornada: 'media', perfil: 'tania' })
    expect(client.insertPayload('payroll_employees')).toEqual({ name: 'Pedro Gómez', shift: 'part_time', profile_id: TANIA.id })
    expect(result).toMatchObject({ accion: 'creado', empleado: { nombre: 'Pedro Gómez', jornada: 'Medio tiempo · 4 h', perfil_ligado: 'Tania López', activo: true } })
  })

  test('baja = activo false sobre el empleado por nombre exacto; nunca un delete', async () => {
    const client = createMockSupabase({
      responses: { 'payroll_employees.select': { data: TEAM, error: null }, 'payroll_employees.update': { data: employee('e1', 'Juan Pérez', { active: false }), error: null } },
    })
    const result = await savePayrollEmployee(asDb(client), 'u-admin', { empleado: 'juan perez', activo: false })
    const update = client.callsTo('payroll_employees', 'update')[0]
    expect(update.payload).toEqual({ active: false })
    expect(filterValue(update, 'id')).toBe('e1')
    expect(client.didCall('payroll_employees', 'delete')).toBe(false)
    expect(result.nota).toMatch(/Dado de baja/)

    // Read from a visible list, then 0 rows on the update: it went away, it is not "no access" (review PR #139).
    const gone = createMockSupabase({
      responses: { 'payroll_employees.select': { data: TEAM, error: null }, 'payroll_employees.update': { data: null, error: null } },
    })
    await expect(savePayrollEmployee(asDb(gone), 'u-admin', { empleado: 'juan perez', activo: false })).rejects.toThrow(/ya no existe/)
  })

  test('REGLA: perfil "" desliga — nunca cae en "sin nombre = quien pregunta"', async () => {
    const client = createMockSupabase({
      responses: { 'payroll_employees.select': { data: TEAM, error: null }, 'payroll_employees.update': { data: employee('e3', 'José Núñez'), error: null } },
    })
    await savePayrollEmployee(asDb(client), 'u-admin', { empleado: 'josé', perfil: '' })
    expect(client.updatePayload('payroll_employees')).toEqual({ profile_id: null })
    expect(client.callsTo('profiles')).toEqual([])
  })

  test('sin nombre, sin cambios, sin acceso y duplicado: error claro sin escribir de más', async () => {
    const admin = createMockSupabase({ responses: { 'payroll_employees.select': { data: TEAM, error: null } } })
    await expect(savePayrollEmployee(asDb(admin), 'u-admin', { jornada: 'media' })).rejects.toThrow(/nombre es obligatorio/)
    await expect(savePayrollEmployee(asDb(admin), 'u-admin', { empleado: 'José' })).rejects.toThrow(/No hay cambios/)
    expect(admin.didCall('payroll_employees', 'insert')).toBe(false)

    // A member reads no employees and the RLS rejects the insert (42501).
    const member = createMockSupabase({
      responses: { 'payroll_employees.select': { data: [], error: null }, 'payroll_employees.insert': { data: null, error: { code: '42501', message: 'rls' } } },
    })
    await expect(savePayrollEmployee(asDb(member), 'u-member', { empleado: 'Juan', activo: false })).rejects.toThrow(/solo la ve un administrador/)
    await expect(savePayrollEmployee(asDb(member), 'u-member', { nombre: 'Intruso' })).rejects.toThrow(/Solo un administrador/)

    const dup = createMockSupabase({ responses: { 'payroll_employees.insert': { data: null, error: { code: '23505', message: 'payroll_employees_name_key' } } } })
    await expect(savePayrollEmployee(asDb(dup), 'u-admin', { nombre: 'Juan Pérez' })).rejects.toThrow(/ya existe un empleado con ese nombre/i)
  })
})
