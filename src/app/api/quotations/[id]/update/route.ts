import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { QuotationError, updateQuotation } from '@/lib/quotations-store'

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
    if (error instanceof QuotationError) return NextResponse.json(error.body, { status: error.status })
    console.error(`Update quotation error quotationId=${id}:`, error)
    return NextResponse.json({ message: 'Error al actualizar la cotización' }, { status: 500 })
  }
}
