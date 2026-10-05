/** GET /api/hours/overview (2026-10-05): admin-only week of the office (clock) and the workshop (Nómina). */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, filterValue, type CallRecord } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, readJson } from '../helpers/request'
import { AUTH } from '../helpers/factories'
import * as overview from '@/app/api/hours/overview/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const role = (r: 'admin' | 'member') => (rec: CallRecord) =>
  filterValue(rec, 'id') === AUTH.id
    ? { data: { id: AUTH.id, role: r, display_name: 'Axl' }, error: null }
    : { data: [{ id: 'u-tania', display_name: 'Tania', shift: 'part_time', hourly_rate: '52.00', avatar_path: null, area: 'office' }, { id: 'u-taller', display_name: 'Pedro', shift: 'full_time', hourly_rate: '52.00', avatar_path: null, area: 'workshop' }], error: null }

const get = (query = '') => overview.GET(makeRequest(undefined, { url: `http://x/api/hours/overview${query}` }))

describe('GET /api/hours/overview', () => {
  test('un member → 403 sin leer horas', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': role('member') } })
    expect((await get()).status).toBe(403)
    expect(activeClient.didCall('time_entries', 'select')).toBe(false)
  })

  test('semana inválida → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': role('admin') } })
    expect((await get('?week=2026-02-30')).status).toBe(400)
  })

  test('oficina desde el checador con pago, taller desde Nómina, y totales', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': role('admin'),
        'time_entries.select': { data: [{ user_id: 'u-tania', work_date: '2026-09-28', source_clock_in: '09:00:00', clock_in: '09:00:00', clock_out: '13:00:00' }], error: null },
        'excused_days.select': { data: [], error: null },
        'payroll_employees.select': { data: [{ id: 'e-jose', name: 'José', shift: 'full_time' }], error: null },
        'payroll_days.select': { data: [{ employee_id: 'e-jose', work_date: '2026-10-03', worked_minutes: 300, status: 'draft' }], error: null },
      },
    })
    const res = await get('?week=2026-10-01')
    expect(res.status).toBe(200)
    const body = await readJson<{ start: string; office: { minutes: number; pay: { amount: number } }[]; workshop: { minutes: number; drafts: number }[]; totals: unknown }>(res)
    expect(body.start).toBe('2026-09-28')
    expect(body.office[0]).toMatchObject({ minutes: 240, pay: { amount: (4 + 4) * 52 } })
    // A workshop person with an account comes from the clock, with no pay; the sheet ones after.
    expect(body.workshop.map((w) => (w as { source: string }).source)).toEqual(['clock', 'payroll'])
    expect(body.workshop[1]).toMatchObject({ minutes: 300, drafts: 1 })
    expect(body.office).toHaveLength(1)
    expect(body.totals).toEqual({ officeMinutes: 240, officePay: 416, workshopMinutes: 300 })
    // Only active workshop people without an app account.
    const employees = activeClient.callsTo('payroll_employees', 'select')[0]
    expect(filterValue(employees, 'active')).toBe(true)
    expect(employees.filters.some((f) => f.method === 'is' && f.args[0] === 'profile_id')).toBe(true)
  })
})
