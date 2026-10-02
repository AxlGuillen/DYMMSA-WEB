import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, serverError } from '@/lib/api-helpers'
import { prefillFromHours, PayrollError } from '@/lib/payroll-store'

// POST /api/payroll/periods/[start]/prefill — clocked hours of the linked people, as drafts (admin)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ start: string }> },
) {
  try {
    const { start } = await params
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error
    return NextResponse.json(await prefillFromHours(supabase, start))
  } catch (error) {
    if (error instanceof PayrollError) return badRequest(error.message)
    console.error('Payroll prefill error:', error)
    return serverError('Error al traer las horas')
  }
}
