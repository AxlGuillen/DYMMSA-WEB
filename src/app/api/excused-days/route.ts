import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireAdmin, badRequest, serverError, isUuid } from '@/lib/api-helpers'
import { parseExcusedDay } from '@/lib/timesheet'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const COLUMNS = 'id, work_date, user_id, kind, note, created_by, created_at'

// GET /api/excused-days?from=&to= — RLS decides: a member sees team-wide days and their own
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) return badRequest('Rango de fechas inválido')

    let query = supabase.from('excused_days').select(COLUMNS).order('work_date', { ascending: false }).limit(200)
    if (from) query = query.gte('work_date', from)
    if (to) query = query.lte('work_date', to)
    const { data, error } = await query
    if (error) {
      console.error('Error fetching excused days:', error)
      return serverError('Error al obtener los días justificados')
    }
    return NextResponse.json(data ?? [])
  } catch (error) {
    console.error('Excused days GET error:', error)
    return serverError('Error al obtener los días justificados')
  }
}

// POST /api/excused-days — admin marks a holiday or an authorized early exit (whole team or one person)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const parsed = parseExcusedDay(await request.json())
    if ('error' in parsed) return badRequest(parsed.error)
    if (parsed.value.user_id && !isUuid(parsed.value.user_id)) return badRequest('Persona inválida')

    const { data, error } = await supabase.from('excused_days').insert(parsed.value).select(COLUMNS).single()
    if (error || !data) {
      if (error?.code === '23505') {
        return badRequest(parsed.value.user_id ? 'Ese día ya está justificado para esa persona' : 'Ese día ya está justificado para todo el equipo')
      }
      if (error?.code === '23503') return badRequest('La persona no existe')
      console.error('Error creating excused day:', error)
      return serverError('Error al guardar el día justificado')
    }
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Excused days POST error:', error)
    return serverError('Error al guardar el día justificado')
  }
}
