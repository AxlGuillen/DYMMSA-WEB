import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireAdmin, apiError, badRequest, serverError } from '@/lib/api-helpers'
import { createExcusedDay, EXCUSED_COLUMNS as COLUMNS } from '@/lib/excused-days-store'
import { isRealDate } from '@/lib/timesheet'

// GET /api/excused-days?from=&to= — RLS decides: a member sees team-wide days and their own
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if ((from && !isRealDate(from)) || (to && !isRealDate(to))) return badRequest('Rango de fechas inválido')

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

    return NextResponse.json(await createExcusedDay(supabase, await request.json()), { status: 201 })
  } catch (error) {
    return apiError(error, 'Error al guardar el día justificado', 'Excused days POST error:')
  }
}
