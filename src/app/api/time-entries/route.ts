import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, requireAdmin, badRequest, forbidden, serverError, isUuid } from '@/lib/api-helpers'
import { createManualEntry, TimeEntryError } from '@/lib/time-entries-store'
import { todayInMexico } from '@/lib/format'
import { buildWeekView, isRealDate, normalizeEntryTimes, weekBounds } from '@/lib/timesheet'
import type { ExcusedDay, TimeEntry } from '@/types/database'

function isWholeWeek(from: string, to: string): boolean {
  const bounds = weekBounds(from)
  return bounds.start === from && bounds.end === to
}

// GET /api/time-entries?user=&from=&to= — members always get their own rows, whatever `user` says.
// `week` is null unless from..to is exactly a Monday→Sunday week: a partial range has no weekly total.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireRole(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const requested = searchParams.get('user')
    if (requested && !isUuid(requested)) return badRequest('Usuario inválido')

    const isAdmin = auth.profile?.role === 'admin'
    const target = isAdmin && requested ? requested : auth.user.id

    const defaults = weekBounds(todayInMexico())
    const from = searchParams.get('from') ?? defaults.start
    const to = searchParams.get('to') ?? defaults.end
    if (!isRealDate(from) || !isRealDate(to) || from > to) return badRequest('Rango de fechas inválido')

    const { data, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('user_id', target)
      .gte('work_date', from)
      .lte('work_date', to)
      .order('work_date', { ascending: true })
      .order('clock_in', { ascending: true })

    if (error) {
      console.error('Error fetching time entries:', error)
      return serverError('Error al obtener las checadas')
    }

    const excusedRes = await supabase
      .from('excused_days')
      .select('id, work_date, user_id, kind, note, created_by, created_at')
      .gte('work_date', from)
      .lte('work_date', to)
      .or(`user_id.is.null,user_id.eq.${target}`)
      .order('work_date', { ascending: true })
    if (excusedRes.error) console.error('Error fetching excused days:', excusedRes.error)

    const entries = ((data ?? []) as TimeEntry[]).map(normalizeEntryTimes)
    return NextResponse.json({
      user: target,
      from,
      to,
      entries,
      week: isWholeWeek(from, to) ? buildWeekView(entries, from) : null,
      // A failed read degrades to "no excused days", never to a broken week.
      excused: (excusedRes.data ?? []) as ExcusedDay[],
    })
  } catch (error) {
    console.error('Time entries GET error:', error)
    return serverError('Error al obtener las checadas')
  }
}

// POST /api/time-entries — manual pair (admin); reconciled by a later import unless edited
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as Partial<TimeEntry>
    if (typeof body.user_id !== 'string' || !isUuid(body.user_id)) return badRequest('Usuario inválido')
    const entry = await createManualEntry(supabase, { ...body, user_id: body.user_id })
    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    if (error instanceof TimeEntryError) return error.kind === 'forbidden' ? forbidden() : badRequest(error.message)
    console.error('Time entries POST error:', error)
    return serverError('Error al registrar la checada')
  }
}
