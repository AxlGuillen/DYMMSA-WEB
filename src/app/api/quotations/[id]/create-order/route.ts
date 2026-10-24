import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { createOrderFromQuotation, OrderError } from '@/lib/orders-store'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    // The quotation must be approved; any authenticated user can create the order.
    console.log(`[create-order] START quotationId=${id} userId=${auth.user.id}`)
    return NextResponse.json(await createOrderFromQuotation(supabase, id, auth.user.id))
  } catch (error) {
    if (error instanceof OrderError) return NextResponse.json(error.body, { status: error.status })
    console.error(`[create-order] unhandled error quotationId=${id}`, error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
