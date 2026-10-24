import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { createManualOrder } from '@/lib/orders-store'
import type { CreateOrderInput } from '@/types/database'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const input = (await request.json()) as CreateOrderInput
    return NextResponse.json(await createManualOrder(supabase, input, auth.user.id))
  } catch (error) {
    return apiError(error, 'Error al crear orden', 'Create order error:')
  }
}
