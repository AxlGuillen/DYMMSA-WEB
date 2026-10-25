import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { removeOrderItem, updateOrderItem } from '@/lib/orders-store'

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
    return apiError(error, 'Error interno', 'Edit order item error:')
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
    return apiError(error, 'Error interno', 'Delete order item error:')
  }
}
