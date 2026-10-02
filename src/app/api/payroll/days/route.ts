import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, serverError, isUuid } from '@/lib/api-helpers'
import { saveDays, PayrollError, type DayInput } from '@/lib/payroll-store'
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

    if (day.worked_minutes === 0 && day.missed_minutes === 0 && !day.note?.trim()) {
      const { error } = await supabase
        .from('payroll_days')
        .delete()
        .eq('employee_id', day.employee_id)
        .eq('work_date', day.work_date)
      if (error) {
        if (error.code === '23514') return badRequest(error.message)
        console.error('Error deleting payroll day:', error)
        return serverError('Error al borrar el día')
      }
      return NextResponse.json({ saved: 0, skipped: [], deleted: true })
    }

    const result = await saveDays(supabase, [day], { source: 'manual', status: 'confirmed', overwrite: true })
    return NextResponse.json({ ...result, deleted: false })
  } catch (error) {
    if (error instanceof PayrollError) return badRequest(error.message)
    console.error('Payroll day PUT error:', error)
    return serverError('Error al guardar el día')
  }
}
