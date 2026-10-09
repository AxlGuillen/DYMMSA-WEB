import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, notFound, serverError, isUuid } from '@/lib/api-helpers'
import { parseEmployeeInput } from '@/lib/payroll'
import { PayrollError, updateEmployee } from '@/lib/payroll-store'

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

    const data = await updateEmployee(supabase, id, parsed.value)
    if (!data) return notFound('El empleado no existe')
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof PayrollError) return badRequest(error.message)
    console.error('Payroll employee PATCH error:', error)
    return serverError('Error al actualizar el empleado')
  }
}
