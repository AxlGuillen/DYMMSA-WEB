import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { setQuotationStatus } from '@/lib/quotations-store'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { status } = (await request.json()) as { status: unknown }
    // Every change regenerates approval_token (the old link dies); converted_to_order is not a manual target.
    return NextResponse.json(await setQuotationStatus(supabase, id, status))
  } catch (error) {
    return apiError(error, 'Error al actualizar el estado', 'PATCH quotation status error:')
  }
}
