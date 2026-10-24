import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { createManualOrder, OrderError } from '@/lib/orders-store'
import type { CreateOrderInput } from '@/types/database'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const input = (await request.json()) as CreateOrderInput
    return NextResponse.json(await createManualOrder(supabase, input, auth.user.id))
  } catch (error) {
    if (error instanceof OrderError) return NextResponse.json(error.body, { status: error.status })
    console.error('Create order error:', error)
    return NextResponse.json({ message: 'Error al crear orden' }, { status: 500 })
  }
}
