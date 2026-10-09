/** /api/payroll/*: admin gate on every route, the draft/confirmed rules and the closed cut (#123). */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, type CallRecord } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import { AUTH } from '../helpers/factories'
import * as employeesRoute from '@/app/api/payroll/employees/route'
import * as employeeById from '@/app/api/payroll/employees/[id]/route'
import * as periodRoute from '@/app/api/payroll/periods/[start]/route'
import * as prefillRoute from '@/app/api/payroll/periods/[start]/prefill/route'
import * as confirmRoute from '@/app/api/payroll/periods/[start]/confirm/route'
import * as daysRoute from '@/app/api/payroll/days/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const ADMIN = { data: { id: AUTH.id, role: 'admin', display_name: 'Axl' }, error: null }
const MEMBER = { data: { id: AUTH.id, role: 'member', display_name: 'Tania' }, error: null }
const SAT = '2026-09-19'
const EMP = '11111111-1111-4111-8111-111111111111'
const PROFILE = '22222222-2222-4222-8222-222222222222'

const employee = (over: Record<string, unknown> = {}) => ({
  id: EMP, name: 'Juan', profile_id: null, shift: 'full_time', active: true, created_at: '', updated_at: '', ...over,
})
const dayRow = (date: string, over: Record<string, unknown> = {}) => ({
  id: `d-${date}`, employee_id: EMP, work_date: date, worked_minutes: 480, missed_minutes: 0, note: null,
  source: 'manual', status: 'confirmed', created_at: '', updated_at: '', ...over,
})

/** profiles answers the admin check (.single) and, as a list, the area of each linked profile (#135). */
function client(responses: Record<string, unknown>, profile = ADMIN, areas: { id: string; area: string }[] = []) {
  const profiles = (rec: CallRecord) => (rec.single ? profile : { data: areas, error: null })
  return createMockSupabase({ user: AUTH, responses: { 'profiles.select': profiles, ...responses } as never })
}

const startParams = (start = SAT) => makeParams({ start })

describe('solo administradores', () => {
  test('cada ruta responde 403 a un member y 401 sin sesión, sin tocar las tablas de nómina', async () => {
    const calls = [
      () => employeesRoute.GET(),
      () => employeesRoute.POST(makeRequest({ name: 'Juan' })),
      () => employeeById.PATCH(makeRequest({ active: false }, { method: 'PATCH' }), makeParams({ id: EMP })),
      () => periodRoute.GET(makeRequest(), startParams()),
      () => periodRoute.PATCH(makeRequest({ closed: true }, { method: 'PATCH' }), startParams()),
      () => prefillRoute.POST(makeRequest(undefined, { method: 'POST' }), startParams()),
      () => confirmRoute.POST(makeRequest(undefined, { method: 'POST' }), startParams()),
      () => daysRoute.PUT(makeRequest({ employee_id: EMP, work_date: SAT, worked_minutes: 60 }, { method: 'PUT' })),
    ]
    for (const call of calls) {
      activeClient = client({}, MEMBER)
      expect((await call()).status).toBe(403)
      expect(activeClient._calls.filter((c) => c.table.startsWith('payroll_'))).toEqual([])

      activeClient = createMockSupabase({ user: null })
      expect((await call()).status).toBe(401)
    }
  })
})

describe('empleados', () => {
  test('POST valida el nombre y traduce el duplicado', async () => {
    activeClient = client({})
    expect((await employeesRoute.POST(makeRequest({ name: '  ' }))).status).toBe(400)

    activeClient = client({ 'payroll_employees.insert': { data: employee(), error: null } })
    const ok = await employeesRoute.POST(makeRequest({ name: ' Juan ', profile_id: PROFILE, shift: 'part_time' }))
    expect(ok.status).toBe(201)
    expect(activeClient.insertPayload<Record<string, unknown>>('payroll_employees')).toEqual({ name: 'Juan', profile_id: PROFILE, shift: 'part_time' })

    activeClient = client({ 'payroll_employees.insert': { data: null, error: { code: '23505', message: 'payroll_employees_name_key' } } })
    const dup = await employeesRoute.POST(makeRequest({ name: 'Juan' }))
    expect(dup.status).toBe(400)
    expect((await readJson<{ message: string }>(dup)).message).toMatch(/ese nombre/)

    activeClient = client({ 'payroll_employees.insert': { data: null, error: { code: '23505', message: 'payroll_employees_profile_id_key' } } })
    expect((await readJson<{ message: string }>(await employeesRoute.POST(makeRequest({ name: 'Juan', profile_id: PROFILE })))).message).toMatch(/ya está ligado/)
  })

  test('PATCH: sin cambios 400, inexistente 404, y desactiva sin borrar', async () => {
    const patch = (id: string, body: unknown) => employeeById.PATCH(makeRequest(body, { method: 'PATCH' }), makeParams({ id }))
    activeClient = client({})
    expect((await patch(EMP, {})).status).toBe(400)
    expect((await patch('nope', { active: false })).status).toBe(404)

    activeClient = client({ 'payroll_employees.update': { data: null, error: null } })
    expect((await patch(EMP, { active: false })).status).toBe(404)

    activeClient = client({ 'payroll_employees.update': { data: employee({ active: false }), error: null } })
    expect((await patch(EMP, { active: false })).status).toBe(200)
    expect(activeClient.updatePayload('payroll_employees')).toEqual({ active: false })
    expect('DELETE' in employeeById).toBe(false)
  })
})

describe('corte', () => {
  test('GET arma la vista con totales; un inicio que no es sábado → 400', async () => {
    activeClient = client({
      'payroll_employees.select': { data: [employee()], error: null },
      'payroll_days.select': { data: [dayRow(SAT, { worked_minutes: 420 }), dayRow('2026-09-21', { worked_minutes: 600 })], error: null },
      'payroll_periods.select': { data: null, error: null },
    })
    const res = await periodRoute.GET(makeRequest(), startParams())
    expect(res.status).toBe(200)
    const view = await readJson<{ end: string; closed: boolean; rows: { area: string; totals: Record<string, number> }[] }>(res)
    expect(view).toMatchObject({ end: '2026-09-25', closed: false })
    // Workshop Saturday of 7 h: 5 normal + 2 at double (#135).
    expect(view.rows[0].area).toBe('workshop')
    expect(view.rows[0].totals).toEqual({ regular: 480 + 300, extra: 120, saturdayExtra: 120, sunday: 0, equivalent: 480 + 300 + 120 + 240 })

    expect((await periodRoute.GET(makeRequest(), startParams('2026-09-21'))).status).toBe(400)
  })

  test('cerrar exige cero borradores y sella quién; reabrir sella quién reabrió', async () => {
    const patch = (closed: unknown) => periodRoute.PATCH(makeRequest({ closed }, { method: 'PATCH' }), startParams())
    activeClient = client({})
    expect((await patch('si')).status).toBe(400)

    activeClient = client({ 'payroll_days.select': { data: null, error: null, count: 2 } })
    const blocked = await patch(true)
    expect(blocked.status).toBe(400)
    expect((await readJson<{ message: string }>(blocked)).message).toMatch(/2 días en borrador/)
    expect(activeClient.callsTo('payroll_periods', 'upsert')).toEqual([])

    activeClient = client({
      'payroll_days.select': { data: null, error: null, count: 0 },
      'payroll_periods.upsert': { data: { start_date: SAT, status: 'closed' }, error: null },
    })
    expect((await patch(true)).status).toBe(200)
    expect(activeClient.upsertPayload<Record<string, unknown>>('payroll_periods')).toMatchObject({ start_date: SAT, status: 'closed', closed_by_name: 'Axl' })

    // Reopening a cut that was never closed stamps nothing.
    activeClient = client({ 'payroll_periods.select': { data: null, error: null } })
    expect(await readJson(await patch(false))).toMatchObject({ start_date: SAT, status: 'open', reopened_at: null })
    expect(activeClient.callsTo('payroll_periods', 'upsert')).toEqual([])

    activeClient = client({
      'payroll_periods.select': { data: { start_date: SAT, status: 'closed' }, error: null },
      'payroll_periods.upsert': { data: { start_date: SAT, status: 'open' }, error: null },
    })
    expect((await patch(false)).status).toBe(200)
    expect(activeClient.upsertPayload<Record<string, unknown>>('payroll_periods')).toMatchObject({ status: 'open', reopened_by_name: 'Axl' })
    expect(activeClient.upsertPayload<Record<string, unknown>>('payroll_periods')).not.toHaveProperty('closed_at')
  })

  test('confirm pasa los borradores del corte a confirmados', async () => {
    activeClient = client({ 'payroll_days.update': { data: [{ id: 'a' }, { id: 'b' }], error: null } })
    const res = await confirmRoute.POST(makeRequest(undefined, { method: 'POST' }), startParams())
    expect(await readJson(res)).toEqual({ confirmed: 2 })
    const update = activeClient.callsTo('payroll_days', 'update')[0]
    expect(update.payload).toEqual({ status: 'confirmed' })
    expect(update.filters).toEqual(expect.arrayContaining([
      { method: 'eq', args: ['status', 'draft'] },
      { method: 'gte', args: ['work_date', SAT] },
      { method: 'lte', args: ['work_date', '2026-09-25'] },
    ]))
  })
})

describe('PUT /api/payroll/days', () => {
  const put = (body: unknown) => daysRoute.PUT(makeRequest(body, { method: 'PUT' }))

  test('la captura del admin pisa lo que haya y queda confirmada', async () => {
    activeClient = client({
      'payroll_days.select': { data: [dayRow('2026-09-21', { source: 'sheet', status: 'draft', missed_minutes: 30 })], error: null },
      'payroll_periods.select': { data: [], error: null },
      'payroll_days.upsert': { data: null, error: null },
    })
    const res = await put({ employee_id: EMP, work_date: '2026-09-21', worked_minutes: 690, note: ' salió 19:30 ' })
    expect(res.status).toBe(200)
    expect(activeClient.upsertPayload('payroll_days')).toEqual([{
      employee_id: EMP, work_date: '2026-09-21', worked_minutes: 690, missed_minutes: 0, note: 'salió 19:30', source: 'manual', status: 'confirmed',
    }])
    expect(activeClient.callsTo('payroll_days', 'upsert')[0].options).toEqual({ onConflict: 'employee_id,work_date' })
  })

  test('valida empleado, fecha y minutos; un día vacío borra la fila', async () => {
    activeClient = client({})
    expect((await put({ employee_id: 'x', work_date: SAT, worked_minutes: 60 })).status).toBe(400)
    expect((await put({ employee_id: EMP, work_date: '21/09/2026', worked_minutes: 60 })).status).toBe(400)
    expect((await put({ employee_id: EMP, work_date: SAT, worked_minutes: 1500 })).status).toBe(400)
    expect((await put({ employee_id: EMP, work_date: SAT, worked_minutes: 7.5 })).status).toBe(400)

    activeClient = client({ 'payroll_days.delete': { data: null, error: null } })
    const res = await put({ employee_id: EMP, work_date: SAT, worked_minutes: 0, note: '  ' })
    expect(await readJson(res)).toMatchObject({ deleted: true })
    expect(activeClient.callsTo('payroll_days', 'upsert')).toEqual([])
  })

  test('corte cerrado → 400, por la ruta y por el trigger', async () => {
    activeClient = client({
      'payroll_days.select': { data: [], error: null },
      'payroll_periods.select': { data: [{ start_date: SAT }], error: null },
    })
    const res = await put({ employee_id: EMP, work_date: '2026-09-21', worked_minutes: 60 })
    expect(res.status).toBe(400)
    expect((await readJson<{ message: string }>(res)).message).toMatch(/está cerrado/)
    expect(activeClient.callsTo('payroll_days', 'upsert')).toEqual([])

    activeClient = client({ 'payroll_days.delete': { data: null, error: { code: '23514', message: 'El corte de nómina que incluye el 2026-09-19 está cerrado' } } })
    expect((await put({ employee_id: EMP, work_date: SAT, worked_minutes: 0 })).status).toBe(400)
  })
})

describe('POST prefill', () => {
  const prefill = () => prefillRoute.POST(makeRequest(undefined, { method: 'POST' }), startParams())

  test('copia las checadas de los ligados como borrador y no pisa lo confirmado ni lo manual', async () => {
    const entry = (date: string, clockIn: string, clockOut: string | null) => ({ user_id: PROFILE, work_date: date, source_clock_in: clockIn, clock_in: clockIn, clock_out: clockOut })
    activeClient = client({
      'payroll_employees.select': { data: [employee({ profile_id: PROFILE }), employee({ id: 'taller', name: 'Taller' })], error: null },
      'time_entries.select': {
        data: [
          entry('2026-09-21', '09:00:00', '13:00:00'), entry('2026-09-21', '14:00:00', '18:00:00'),
          entry('2026-09-22', '09:00', '17:00'), entry('2026-09-23', '09:00', '17:00'), entry('2026-09-24', '09:00', null),
        ],
        error: null,
      },
      'payroll_days.select': {
        data: [dayRow('2026-09-22', { source: 'hours', status: 'confirmed' }), dayRow('2026-09-23', { source: 'manual', status: 'draft' })],
        error: null,
      },
      'payroll_periods.select': { data: [], error: null },
      'payroll_days.upsert': { data: null, error: null },
    })
    const res = await prefill()
    expect(res.status).toBe(200)
    const body = await readJson<{ saved: number; open: number; linked: number; skipped: { work_date: string; reason: string }[] }>(res)
    expect(body).toMatchObject({ saved: 1, open: 1, linked: 1 })
    expect(body.skipped.map((s) => [s.work_date, s.reason])).toEqual([['2026-09-22', 'ya está confirmado'], ['2026-09-23', 'se capturó a mano']])
    const rows = activeClient.upsertPayload('payroll_days')
    expect(rows.map((r) => [r.work_date, r.worked_minutes, r.source, r.status])).toEqual([
      ['2026-09-21', 480, 'hours', 'draft'],
    ])
    // The 24th only has an open punch: no 0-hour draft, and its own stale draft is dropped.
    const stale = activeClient.callsTo('payroll_days', 'delete')
    expect(stale).toHaveLength(1)
    expect(stale[0].filters).toEqual(expect.arrayContaining([
      { method: 'eq', args: ['work_date', '2026-09-24'] },
      { method: 'eq', args: ['source', 'hours'] },
      { method: 'eq', args: ['status', 'draft'] },
    ]))
    const read = activeClient.callsTo('time_entries')[0] as CallRecord
    expect(read.filters).toEqual(expect.arrayContaining([{ method: 'in', args: ['user_id', [PROFILE]] }]))
  })

  test('una pareja cerrada que da 0 minutos (cruza medianoche) deja su fila visible y no borra nada', async () => {
    activeClient = client({
      'payroll_employees.select': { data: [employee({ profile_id: PROFILE })], error: null },
      'time_entries.select': { data: [{ user_id: PROFILE, work_date: '2026-09-21', source_clock_in: '22:00', clock_in: '22:00', clock_out: '06:00' }], error: null },
      'payroll_days.select': { data: [], error: null },
      'payroll_periods.select': { data: [], error: null },
      'payroll_days.upsert': { data: null, error: null },
    })
    expect(await readJson(await prefill())).toMatchObject({ saved: 1, open: 0 })
    expect(activeClient.upsertPayload('payroll_days')[0]).toMatchObject({ work_date: '2026-09-21', worked_minutes: 0 })
    expect(activeClient.callsTo('payroll_days', 'delete')).toEqual([])
  })

  test('si el borrado del borrador viejo topa con un corte cerrado responde 400, no 500', async () => {
    activeClient = client({
      'payroll_employees.select': { data: [employee({ profile_id: PROFILE })], error: null },
      'time_entries.select': { data: [{ user_id: PROFILE, work_date: '2026-09-21', source_clock_in: '09:00', clock_in: '09:00', clock_out: null }], error: null },
      'payroll_days.delete': { data: null, error: { code: '23514', message: 'El corte de nómina que incluye el 2026-09-21 está cerrado' } },
    })
    const res = await prefill()
    expect(res.status).toBe(400)
    expect((await readJson<{ message: string }>(res)).message).toMatch(/está cerrado/)
  })

  test('sin nadie ligado no lee checadas', async () => {
    activeClient = client({ 'payroll_employees.select': { data: [employee()], error: null } })
    expect(await readJson(await prefill())).toEqual({ saved: 0, skipped: [], open: 0, linked: 0, officeSaturdays: 0 })
    expect(activeClient.callsTo('time_entries')).toEqual([])
  })

  test('REGLA #135: la oficina recibe su sábado pagado como borrador (8 h, 4 a medio tiempo); si checó más, lo mayor; el taller no', async () => {
    const HALF = '33333333-3333-4333-8333-333333333333'
    const SHOP = '44444444-4444-4444-8444-444444444444'
    const entry = (user: string, clockIn: string, clockOut: string) => ({ user_id: user, work_date: SAT, source_clock_in: clockIn, clock_in: clockIn, clock_out: clockOut })
    const team = [
      employee({ profile_id: PROFILE }),
      employee({ id: 'half', name: 'Medio', profile_id: HALF, shift: 'part_time' }),
      employee({ id: 'shop', name: 'Taller', profile_id: SHOP }),
    ]
    const areas = [{ id: PROFILE, area: 'office' }, { id: HALF, area: 'office' }, { id: SHOP, area: 'workshop' }]
    activeClient = client({
      'payroll_employees.select': { data: team, error: null },
      // Juan clocked 3 h on Saturday (less than his 8), Medio 6 h (more than her 4), the workshop nothing.
      'time_entries.select': { data: [entry(PROFILE, '09:00', '12:00'), entry(HALF, '09:00', '15:00')], error: null },
      'payroll_days.select': { data: [], error: null },
      'payroll_periods.select': { data: [], error: null },
      'payroll_days.upsert': { data: null, error: null },
    }, ADMIN, areas)
    expect(await readJson(await prefill())).toMatchObject({ saved: 2, officeSaturdays: 1 })
    expect(activeClient.upsertPayload('payroll_days').map((r) => [r.employee_id, r.work_date, r.worked_minutes, r.note, r.status])).toEqual([
      [EMP, SAT, 480, 'Sábado de oficina: checó 03:00, se pagan 8 h', 'draft'],
      ['half', SAT, 360, null, 'draft'],
    ])

    // An office Saturday already confirmed is not touched, nor counted as filled.
    activeClient = client({
      'payroll_employees.select': { data: [employee({ profile_id: PROFILE })], error: null },
      'time_entries.select': { data: [], error: null },
      'payroll_days.select': { data: [dayRow(SAT, { source: 'manual', status: 'confirmed' })], error: null },
      'payroll_periods.select': { data: [], error: null },
    }, ADMIN, areas)
    expect(await readJson(await prefill())).toMatchObject({ saved: 0, officeSaturdays: 0, skipped: [{ work_date: SAT, reason: 'ya está confirmado' }] })
  })
})
