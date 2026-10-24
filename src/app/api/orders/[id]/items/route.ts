import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { addOrderItem } from '@/lib/orders-store'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    return NextResponse.json(await addOrderItem(supabase, id, await request.json()))
  } catch (error) {
    return apiError(error, 'Error interno', 'Add order item error:')
  }
}
