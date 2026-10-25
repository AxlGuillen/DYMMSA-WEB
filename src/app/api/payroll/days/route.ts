import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, apiError, badRequest, isUuid } from '@/lib/api-helpers'
import { saveTypedDay, type DayInput } from '@/lib/payroll-store'
import { isIsoDate } from '@/lib/payroll'

// PUT /api/payroll/days — one day as the admin typed it: overwrites and confirms.
// An empty day (0 worked, 0 missed, no note) deletes the row.
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as Partial<DayInput>
    if (typeof body.employee_id !== 'string' || !isUuid(body.employee_id)) return badRequest('Empleado inválido')
    if (!isIsoDate(body.work_date)) return badRequest('Fecha inválida')
    const day: DayInput = {
      employee_id: body.employee_id,
      work_date: body.work_date,
      worked_minutes: body.worked_minutes ?? 0,
      missed_minutes: body.missed_minutes ?? 0,
      note: typeof body.note === 'string' ? body.note : null,
    }

    return NextResponse.json(await saveTypedDay(supabase, day))
  } catch (error) {
    return apiError(error, 'Error al guardar el día', 'Payroll day PUT error:')
  }
}
