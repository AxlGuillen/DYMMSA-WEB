import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { cancelOrder, OrderError } from '@/lib/orders-store'

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await context.params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { restored } = await cancelOrder(supabase, orderId)
    return NextResponse.json({ success: true, inventory_restored: restored })
  } catch (error) {
    if (error instanceof OrderError) return NextResponse.json(error.body, { status: error.status })
    console.error('Cancel order error:', error)
    return NextResponse.json({ message: 'Error al cancelar orden' }, { status: 500 })
  }
}
