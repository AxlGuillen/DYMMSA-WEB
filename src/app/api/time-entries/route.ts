import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, requireAdmin, badRequest, serverError } from '@/lib/api-helpers'
import { todayInMexico } from '@/lib/format'
import { buildWeekView, normalizeEntryTimes, normalizeTime, weekBounds } from '@/lib/timesheet'
import type { TimeEntry } from '@/types/database'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/time-entries?user=&from=&to= — members always get their own rows, whatever `user` says.
// `week` is only meaningful when from..to is exactly a Monday→Sunday week (the UI always sends that).
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireRole(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const requested = searchParams.get('user')
    if (requested && !UUID.test(requested)) return badRequest('Usuario inválido')

    const isAdmin = auth.profile?.role === 'admin'
    const target = isAdmin && requested ? requested : auth.user.id

    const defaults = weekBounds(todayInMexico())
    const from = searchParams.get('from') ?? defaults.start
    const to = searchParams.get('to') ?? defaults.end
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) return badRequest('Rango de fechas inválido')

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

    const entries = ((data ?? []) as TimeEntry[]).map(normalizeEntryTimes)
    return NextResponse.json({
      user: target,
      from,
      to,
      entries,
      week: buildWeekView(entries, weekBounds(from).start),
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
    if (typeof body.user_id !== 'string' || !UUID.test(body.user_id)) return badRequest('Usuario inválido')
    if (typeof body.work_date !== 'string' || !ISO_DATE.test(body.work_date)) return badRequest('Fecha inválida')
    const clockIn = typeof body.clock_in === 'string' ? normalizeTime(body.clock_in) : null
    if (!clockIn) return badRequest('Hora de entrada inválida')
    let clockOut: string | null = null
    if (body.clock_out != null && body.clock_out !== '') {
      clockOut = typeof body.clock_out === 'string' ? normalizeTime(body.clock_out) : null
      if (!clockOut) return badRequest('Hora de salida inválida')
      if (clockOut < clockIn) return badRequest('La salida no puede ser antes de la entrada')
    }

    const { data, error } = await supabase
      .from('time_entries')
      .insert({
        user_id: body.user_id,
        work_date: body.work_date,
        source_clock_in: clockIn,
        clock_in: clockIn,
        clock_out: clockOut,
        note: typeof body.note === 'string' ? body.note.trim() || null : null,
        source: 'manual',
      })
      .select('*')
      .single()

    if (error || !data) {
      if (error?.code === '23505') return badRequest('Ya existe una checada con esa entrada ese día')
      if (error?.code === '23503') return badRequest('El usuario no existe')
      console.error('Error inserting time entry:', error)
      return serverError('Error al registrar la checada')
    }
    return NextResponse.json(normalizeEntryTimes(data as TimeEntry), { status: 201 })
  } catch (error) {
    console.error('Time entries POST error:', error)
    return serverError('Error al registrar la checada')
  }
}
