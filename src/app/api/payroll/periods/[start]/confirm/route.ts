import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, serverError } from '@/lib/api-helpers'
import { confirmDrafts, PayrollError } from '@/lib/payroll-store'

// POST /api/payroll/periods/[start]/confirm — every draft of the cut becomes confirmed (admin)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ start: string }> },
) {
  try {
    const { start } = await params
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error
    return NextResponse.json({ confirmed: await confirmDrafts(supabase, start) })
  } catch (error) {
    if (error instanceof PayrollError) return badRequest(error.message)
    console.error('Payroll confirm error:', error)
    return serverError('Error al confirmar los borradores')
  }
}
