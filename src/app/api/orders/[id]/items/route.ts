import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { addOrderItem, OrderError } from '@/lib/orders-store'

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
    if (error instanceof OrderError) return NextResponse.json(error.body, { status: error.status })
    console.error('Add order item error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
