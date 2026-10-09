/**
 * Payroll against local Supabase (ADR-021/ADR-033): admin-only RLS on the three tables, the
 * trigger that freezes a closed cut, and the prefill from the clock. The mock fakes none of it.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import { authedClient, authedClientAs } from './helpers/clients'
import { resetDb, sql, closePool, LOCAL } from './helpers/db'
import * as periodRoute from '@/app/api/payroll/periods/[start]/route'
import * as prefillRoute from '@/app/api/payroll/periods/[start]/prefill/route'
import * as confirmRoute from '@/app/api/payroll/periods/[start]/confirm/route'
import * as daysRoute from '@/app/api/payroll/days/route'
import { getPayrollPeriod, recordPayrollHours } from '@/lib/mcp/tools/payroll'
import type { PayrollView } from '@/lib/payroll'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let admin: SupabaseClient
let member: SupabaseClient
let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

const SAT = '2026-09-19'
const start = makeParams({ start: SAT })

beforeAll(async () => {
  admin = await authedClient()
  member = await authedClientAs(LOCAL.member)
})
beforeEach(async () => { await resetDb(); activeClient = admin })
afterAll(async () => { await closePool() })

async function seedEmployee(name: string, profileId: string | null = null): Promise<string> {
  const [{ id }] = await sql<{ id: string }>(
    `INSERT INTO public.payroll_employees (name, profile_id) VALUES ($1, $2) RETURNING id`,
    [name, profileId],
  )
  return id
}

const dayRows = () =>
  sql<{ work_date: string; worked_minutes: number; status: string; source: string }>(
    `SELECT work_date::text, worked_minutes, status, source FROM public.payroll_days ORDER BY work_date`,
  )

const putDay = (body: unknown) => daysRoute.PUT(makeRequest(body, { method: 'PUT' }))
const setClosed = (closed: boolean) => periodRoute.PATCH(makeRequest({ closed }, { method: 'PATCH' }), start)

describe('RLS: solo administradores', () => {
  test('un member no lee ni escribe nada de nómina, ni por la API ni directo por PostgREST', async () => {
    const id = await seedEmployee('Juan Taller')
    await sql(`INSERT INTO public.payroll_days (employee_id, work_date, worked_minutes) VALUES ($1, '2026-09-21', 480)`, [id])
    await sql(`INSERT INTO public.payroll_periods (start_date, status) VALUES ('2026-09-12', 'closed')`)

    for (const table of ['payroll_employees', 'payroll_days', 'payroll_periods']) {
      const { data, error } = await member.from(table).select('*')
      expect(error, table).toBeNull()
      expect(data, table).toEqual([])
    }
    expect((await member.from('payroll_employees').insert({ name: 'Intruso' })).error?.code).toBe('42501')
    expect((await member.from('payroll_days').insert({ employee_id: id, work_date: '2026-09-22', worked_minutes: 60 })).error?.code).toBe('42501')
    // An UPDATE the policy filters out touches zero rows instead of erroring.
    await member.from('payroll_days').update({ worked_minutes: 1 }).eq('employee_id', id)
    await member.from('payroll_periods').delete().eq('start_date', '2026-09-12')
    expect((await dayRows())[0].worked_minutes).toBe(480)
    expect(await sql(`SELECT 1 FROM public.payroll_periods`)).toHaveLength(1)

    activeClient = member
    expect((await periodRoute.GET(makeRequest(), start)).status).toBe(403)
    expect((await putDay({ employee_id: id, work_date: '2026-09-22', worked_minutes: 60 })).status).toBe(403)

    // The MCP runs with the caller's token: same wall, with a message instead of a fake empty cut.
    expect((await getPayrollPeriod(member, { fecha: '2026-09-21' })).nota).toMatch(/solo la ve un administrador/)
    await expect(recordPayrollHours(member, { dias: [{ empleado: 'Juan', fecha: '2026-09-22', horas: 8 }] })).rejects.toThrow(/solo la ve un administrador/)
    expect(await dayRows()).toHaveLength(1)
  })

  test('anon no tiene acceso a las tablas', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const anon = createClient(LOCAL.url, LOCAL.anon, { auth: { persistSession: false, autoRefreshToken: false } })
    expect((await anon.from('payroll_days').select('*')).error).not.toBeNull()
  })
})

describe('el corte, de la hoja al cierre', () => {
  test('el asistente carga borradores, el admin confirma, cierra y el corte queda congelado', async () => {
    const id = await seedEmployee('Juan Taller')

    const saved = await recordPayrollHours(admin, {
      dias: [
        { empleado: 'juan', fecha: '2026-09-19', horas: 6 },
        { empleado: 'juan', fecha: '2026-09-21', horas: 11.5 },
        { empleado: 'juan', fecha: '2026-09-26', horas: 5 },
      ],
    })
    expect(saved.guardados).toBe(3)
    expect(saved.cortes.map((c) => c.inicio)).toEqual(['2026-09-19', '2026-09-26'])

    let view = await readJson<PayrollView>(await periodRoute.GET(makeRequest(), start))
    expect(view.drafts).toBe(2)
    expect(view.totals.equivalent).toBe(0)

    const blocked = await setClosed(true)
    expect(blocked.status).toBe(400)

    expect(await readJson(await confirmRoute.POST(makeRequest(undefined, { method: 'POST' }), start))).toEqual({ confirmed: 2 })
    view = await readJson<PayrollView>(await periodRoute.GET(makeRequest(), start))
    // Juan has no account: workshop Saturday of 6 h = 5 normal + 1 at double (#135).
    expect(view.rows[0].totals).toEqual({ regular: 480 + 300, extra: 210, saturdayExtra: 60, sunday: 0, equivalent: 480 + 300 + 210 + 120 })
    // The next cut's Saturday stayed a draft: confirming is per cut.
    expect((await dayRows()).map((d) => d.status)).toEqual(['confirmed', 'confirmed', 'draft'])

    expect((await setClosed(true)).status).toBe(200)
    const [period] = await sql<{ status: string; closed_by_name: string }>(`SELECT status, closed_by_name FROM public.payroll_periods`)
    expect(period).toEqual({ status: 'closed', closed_by_name: 'test' })

    // Frozen for the app, for the assistant and for a raw write with the service role.
    expect((await putDay({ employee_id: id, work_date: '2026-09-21', worked_minutes: 60 })).status).toBe(400)
    expect((await putDay({ employee_id: id, work_date: '2026-09-21', worked_minutes: 0 })).status).toBe(400)
    const again = await recordPayrollHours(admin, { dias: [{ empleado: 'juan', fecha: '2026-09-22', horas: 8 }] })
    expect(again).toMatchObject({ guardados: 0, omitidos: [{ fecha: '2026-09-22', motivo: 'el corte está cerrado' }] })
    await expect(sql(`UPDATE public.payroll_days SET worked_minutes = 1 WHERE work_date = '2026-09-21'`)).rejects.toThrow(/está cerrado/)
    await expect(sql(`DELETE FROM public.payroll_days WHERE work_date = '2026-09-19'`)).rejects.toThrow(/está cerrado/)
    // The following cut is still open.
    expect((await putDay({ employee_id: id, work_date: '2026-09-26', worked_minutes: 300 })).status).toBe(200)

    expect((await setClosed(false)).status).toBe(200)
    expect((await putDay({ employee_id: id, work_date: '2026-09-21', worked_minutes: 600 })).status).toBe(200)
    const [reopened] = await sql<{ status: string; reopened_by_name: string; closed_by_name: string }>(
      `SELECT status, reopened_by_name, closed_by_name FROM public.payroll_periods`,
    )
    expect(reopened).toEqual({ status: 'open', reopened_by_name: 'test', closed_by_name: 'test' })
  })

  test('Traer de Horas copia las checadas del ligado como borrador, le paga el sábado a la oficina y no pisa lo confirmado', async () => {
    const [{ id: memberId }] = await sql<{ id: string }>(`SELECT id FROM public.profiles WHERE role = 'member'`)
    const id = await seedEmployee('Member Oficina', memberId)
    await seedEmployee('Juan Taller')
    await sql(
      `INSERT INTO public.time_entries (user_id, work_date, source_clock_in, clock_in, clock_out, source) VALUES
        ($1, '2026-09-21', '09:00', '09:00', '13:00', 'import'),
        ($1, '2026-09-21', '14:00', '14:00', '18:30', 'import'),
        ($1, '2026-09-22', '09:00', '09:00', '17:00', 'import'),
        ($1, '2026-09-23', '09:00', '09:00', NULL,    'import'),
        ($1, '2026-09-28', '09:00', '09:00', '17:00', 'import')`,
      [memberId],
    )
    expect((await putDay({ employee_id: id, work_date: '2026-09-22', worked_minutes: 420 })).status).toBe(200)

    const res = await prefillRoute.POST(makeRequest(undefined, { method: 'POST' }), start)
    expect(await readJson(res)).toMatchObject({ saved: 2, open: 1, linked: 1, officeSaturdays: 1, skipped: [{ work_date: '2026-09-22', reason: 'ya está confirmado' }] })
    // The seeded member is office: its Saturday is paid (8 h) without a punch, as a draft (#135).
    expect(await dayRows()).toEqual([
      { work_date: '2026-09-19', worked_minutes: 480, status: 'draft', source: 'hours' },
      { work_date: '2026-09-21', worked_minutes: 510, status: 'draft', source: 'hours' },
      { work_date: '2026-09-22', worked_minutes: 420, status: 'confirmed', source: 'manual' },
    ])
    // The 23rd only has an open punch: it stays a gap instead of a 0-hour draft.


    // Running it twice is idempotent: the draft it wrote is its own to refresh.
    await sql(`UPDATE public.time_entries SET clock_out = '19:00' WHERE work_date = '2026-09-21' AND clock_in = '14:00'`)
    await prefillRoute.POST(makeRequest(undefined, { method: 'POST' }), start)
    expect((await dayRows())[1]).toMatchObject({ work_date: '2026-09-21', worked_minutes: 540, status: 'draft' })

    // Clearing the clock-out leaves only open punches: the stale draft goes, the manual day stays.
    await sql(`UPDATE public.time_entries SET clock_out = NULL WHERE work_date = '2026-09-21'`)
    await prefillRoute.POST(makeRequest(undefined, { method: 'POST' }), start)
    expect(await dayRows()).toEqual([
      { work_date: '2026-09-19', worked_minutes: 480, status: 'draft', source: 'hours' },
      { work_date: '2026-09-22', worked_minutes: 420, status: 'confirmed', source: 'manual' },
    ])
  })

  test('constraints: un corte que no empieza en sábado, minutos fuera de rango y empleado duplicado', async () => {
    const id = await seedEmployee('Juan Taller')
    await expect(sql(`INSERT INTO public.payroll_periods (start_date) VALUES ('2026-09-20')`)).rejects.toThrow(/payroll_periods_saturday/)
    // A bare insert must not freeze a cut: no row and no status both mean open.
    expect(await sql(`INSERT INTO public.payroll_periods (start_date) VALUES ('2026-09-12') RETURNING status`)).toEqual([{ status: 'open' }])
    await expect(sql(`INSERT INTO public.payroll_days (employee_id, work_date, worked_minutes) VALUES ($1, '2026-09-21', 1500)`, [id])).rejects.toThrow(/payroll_days_worked_check/)
    await expect(seedEmployee('Juan Taller')).rejects.toThrow(/payroll_employees_name_key/)
    expect((await periodRoute.GET(makeRequest(), makeParams({ start: '2026-09-20' }))).status).toBe(400)
  })
})
