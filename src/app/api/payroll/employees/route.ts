import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, serverError } from '@/lib/api-helpers'
import { createEmployee, loadEmployees, PayrollError } from '@/lib/payroll-store'
import { parseEmployeeInput } from '@/lib/payroll'

// GET /api/payroll/employees — payroll's own list of people (admin)
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error
    return NextResponse.json(await loadEmployees(supabase))
  } catch (error) {
    console.error('Payroll employees GET error:', error)
    return serverError('Error al obtener los empleados')
  }
}

// POST /api/payroll/employees — { name, profile_id?, shift? } (admin)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const parsed = parseEmployeeInput(await request.json(), { requireName: true })
    if ('error' in parsed) return badRequest(parsed.error)

    return NextResponse.json(await createEmployee(supabase, parsed.value), { status: 201 })
  } catch (error) {
    if (error instanceof PayrollError) return badRequest(error.message)
    console.error('Payroll employees POST error:', error)
    return serverError('Error al crear el empleado')
  }
}
