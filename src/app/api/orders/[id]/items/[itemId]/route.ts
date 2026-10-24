import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { OrderError, removeOrderItem, updateOrderItem } from '@/lib/orders-store'

type Params = { params: Promise<{ id: string; itemId: string }> }

// PATCH — Edit unit_price or delivery_time of an order item
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id, itemId } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    return NextResponse.json(await updateOrderItem(supabase, id, itemId, await request.json()))
  } catch (error) {
    if (error instanceof OrderError) return NextResponse.json(error.body, { status: error.status })
    console.error('Edit order item error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}

// DELETE — Remove item and restore its inventory
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id, itemId } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    return NextResponse.json(await removeOrderItem(supabase, id, itemId))
  } catch (error) {
    if (error instanceof OrderError) return NextResponse.json(error.body, { status: error.status })
    console.error('Delete order item error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
