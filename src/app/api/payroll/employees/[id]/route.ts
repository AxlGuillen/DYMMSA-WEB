import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, notFound, serverError, isUuid } from '@/lib/api-helpers'
import { parseEmployeeInput, payrollDuplicateMessage } from '@/lib/payroll'

// PATCH /api/payroll/employees/[id] — name, linked profile, shift, active (admin).
// No DELETE on purpose: someone with recorded hours is deactivated, never removed.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isUuid(id)) return notFound('El empleado no existe')
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const parsed = parseEmployeeInput(await request.json(), { requireName: false })
    if ('error' in parsed) return badRequest(parsed.error)
    if (Object.keys(parsed.value).length === 0) return badRequest('No hay cambios para guardar')

    const { data, error } = await supabase
      .from('payroll_employees')
      .update(parsed.value)
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) {
      if (error.code === '23505') return badRequest(payrollDuplicateMessage(error.message))
      if (error.code === '23503') return badRequest('El perfil ligado no existe')
      console.error('Error updating payroll employee:', error)
      return serverError('Error al actualizar el empleado')
    }
    if (!data) return notFound('El empleado no existe')
    return NextResponse.json(data)
  } catch (error) {
    console.error('Payroll employee PATCH error:', error)
    return serverError('Error al actualizar el empleado')
  }
}
