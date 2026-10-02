import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, serverError } from '@/lib/api-helpers'
import { loadPayrollView, setPeriodClosed, PayrollError } from '@/lib/payroll-store'

// GET /api/payroll/periods/[start] — the Saturday→Friday cut: people, days and totals (admin)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ start: string }> },
) {
  try {
    const { start } = await params
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error
    return NextResponse.json(await loadPayrollView(supabase, start))
  } catch (error) {
    if (error instanceof PayrollError) return badRequest(error.message)
    console.error('Payroll period GET error:', error)
    return serverError('Error al obtener el corte')
  }
}

// PATCH /api/payroll/periods/[start] — { closed: boolean }: close or reopen the cut (admin)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ start: string }> },
) {
  try {
    const { start } = await params
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as { closed?: unknown }
    if (typeof body.closed !== 'boolean') return badRequest('Indica si el corte se cierra o se reabre')
    return NextResponse.json(await setPeriodClosed(supabase, start, body.closed, auth.profile.display_name))
  } catch (error) {
    if (error instanceof PayrollError) return badRequest(error.message)
    console.error('Payroll period PATCH error:', error)
    return serverError('Error al actualizar el corte')
  }
}
