import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, serverError } from '@/lib/api-helpers'
import { todayInMexico } from '@/lib/format'
import { presentProfile } from '@/lib/profile'
import { buildOfficeRows, buildWorkshopRows, teamTotals } from '@/lib/team-hours'
import { isRealDate, normalizeEntryTimes, weekBounds } from '@/lib/timesheet'
import { shiftDays } from '@/lib/month'
import type { ExcusedDay, PayrollDay, PayrollEmployee, Profile, TimeEntry } from '@/types/database'

// GET /api/hours/overview?week= — one Monday→Sunday week of the whole team (admin)
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const today = todayInMexico()
    const requested = new URL(request.url).searchParams.get('week')
    if (requested && !isRealDate(requested)) return badRequest('Semana inválida')
    const { start, end } = weekBounds(requested ?? today)
    const dates = Array.from({ length: 7 }, (_, i) => shiftDays(start, i))

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, display_name, shift, hourly_rate, avatar_path')
      .not('clock_employee_id', 'is', null)
      .order('display_name', { ascending: true })
    if (profilesError) throw profilesError
    const office = ((profiles ?? []) as Pick<Profile, 'id' | 'display_name' | 'shift' | 'hourly_rate' | 'avatar_path'>[]).map(presentProfile)
    const officeIds = office.map((p) => p.id)

    const [entriesRes, excusedRes, employeesRes] = await Promise.all([
      officeIds.length
        ? supabase.from('time_entries').select('user_id, work_date, source_clock_in, clock_in, clock_out').in('user_id', officeIds).gte('work_date', start).lte('work_date', end)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('excused_days').select('work_date, user_id, kind').gte('work_date', start).lte('work_date', end),
      supabase.from('payroll_employees').select('id, name, shift').eq('active', true).is('profile_id', null).order('name', { ascending: true }),
    ])
    for (const res of [entriesRes, excusedRes, employeesRes]) if (res.error) throw res.error

    const workshop = (employeesRes.data ?? []) as Pick<PayrollEmployee, 'id' | 'name' | 'shift'>[]
    const daysRes = workshop.length
      ? await supabase.from('payroll_days').select('employee_id, work_date, worked_minutes, status').in('employee_id', workshop.map((e) => e.id)).gte('work_date', start).lte('work_date', end)
      : { data: [], error: null }
    if (daysRes.error) throw daysRes.error

    const officeRows = buildOfficeRows(
      office,
      ((entriesRes.data ?? []) as Pick<TimeEntry, 'user_id' | 'work_date' | 'source_clock_in' | 'clock_in' | 'clock_out'>[]).map(normalizeEntryTimes),
      (excusedRes.data ?? []) as Pick<ExcusedDay, 'work_date' | 'user_id' | 'kind'>[],
      start,
      today,
    )
    const workshopRows = buildWorkshopRows(workshop, (daysRes.data ?? []) as Pick<PayrollDay, 'employee_id' | 'work_date' | 'worked_minutes' | 'status'>[], dates)

    return NextResponse.json({
      start,
      end,
      office: officeRows,
      workshop: workshopRows,
      totals: teamTotals(officeRows, workshopRows),
    })
  } catch (error) {
    console.error('Hours overview GET error:', error)
    return serverError('Error al obtener el resumen del equipo')
  }
}
