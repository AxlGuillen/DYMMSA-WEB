import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { updateQuotation } from '@/lib/quotations-store'

// PATCH /api/quotations/[id]/update — header + full line list, in one transaction (#157)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = await request.json().catch(() => null)
    return NextResponse.json(await updateQuotation(supabase, auth.user.id, id, body))
  } catch (error) {
    return apiError(error, 'Error al actualizar la cotización', `Update quotation error quotationId=${id}:`)
  }
}
