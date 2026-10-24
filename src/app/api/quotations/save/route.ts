import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { createQuotation } from '@/lib/quotations-store'

// POST /api/quotations/save — creates the quotation and its items
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = await request.json().catch(() => null)
    return NextResponse.json(await createQuotation(supabase, auth.user.id, body))
  } catch (error) {
    return apiError(error, 'Error al guardar la cotización', 'Save quotation error:')
  }
}
