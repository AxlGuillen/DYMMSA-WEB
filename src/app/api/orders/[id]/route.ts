import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { deleteOrder, updateOrderOdooId } from '@/lib/orders-store'

type Params = { params: Promise<{ id: string }> }

// PATCH — Update order metadata (odoo_id)
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    return NextResponse.json(await updateOrderOdooId(supabase, id, await request.json()))
  } catch (error) {
    return apiError(error, 'Error interno', 'PATCH order error:')
  }
}

// DELETE — Remove an order and all its items (any status allowed).
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id: orderId } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    await deleteOrder(supabase, orderId)
    return NextResponse.json({ success: true })
  } catch (error) {
    return apiError(error, 'Error interno', 'Delete order error:')
  }
}
