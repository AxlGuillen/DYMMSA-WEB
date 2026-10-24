import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, apiError } from '@/lib/api-helpers'
import { confirmDrafts } from '@/lib/payroll-store'

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
    return apiError(error, 'Error al confirmar los borradores', 'Payroll confirm error:')
  }
}
