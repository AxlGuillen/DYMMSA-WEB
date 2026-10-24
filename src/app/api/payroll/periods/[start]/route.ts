import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, apiError, badRequest } from '@/lib/api-helpers'
import { loadPayrollView, setPeriodClosed } from '@/lib/payroll-store'

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
    return apiError(error, 'Error al obtener el corte', 'Payroll period GET error:')
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
    return apiError(error, 'Error al actualizar el corte', 'Payroll period PATCH error:')
  }
}
