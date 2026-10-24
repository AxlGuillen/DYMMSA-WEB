import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { confirmReception, OrderError } from '@/lib/orders-store'
import type { ConfirmReceptionInput } from '@/types/database'

/** URREA reception (ADR-019): the rules live in confirmReception (orders-store). */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await context.params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const input = (await request.json()) as ConfirmReceptionInput
    return NextResponse.json(await confirmReception(supabase, orderId, input))
  } catch (error) {
    if (error instanceof OrderError) return NextResponse.json(error.body, { status: error.status })
    console.error('Confirm reception error:', error)
    return NextResponse.json({ message: 'Error al confirmar recepción' }, { status: 500 })
  }
}
