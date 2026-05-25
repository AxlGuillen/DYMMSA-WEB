import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { restoreOrderInventory } from '@/lib/inventory'

type Params = { params: Promise<{ id: string }> }

// PATCH — Update order metadata (odoo_id)
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq('id', id)
      .single()

    if (!order) return NextResponse.json({ message: 'Orden no encontrada' }, { status: 404 })

    const body = await request.json()
    const updates: Record<string, unknown> = {}

    if ('odoo_id' in body) {
      updates.odoo_id = body.odoo_id ?? null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ message: 'Sin cambios' }, { status: 400 })
    }

    const { data: updated, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select('odoo_id')
      .single()

    if (error) {
      console.error('Update order error:', error)
      return NextResponse.json({ message: 'Error al actualizar la orden' }, { status: 500 })
    }

    return NextResponse.json(updated)
  } catch (error) {
    console.error('PATCH order error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}

// DELETE — Remove an order and all its items (any status allowed).
// Restores inventory for items that had quantity_in_stock > 0, same as cancel.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id: orderId } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq('id', orderId)
      .single()

    if (!order) return NextResponse.json({ message: 'Orden no encontrada' }, { status: 404 })

    // Restore inventory before deleting (same logic as cancel)
    await restoreOrderInventory(supabase, orderId)

    // Delete items first (FK), then order
    await supabase.from('order_items').delete().eq('order_id', orderId)
    await supabase.from('orders').delete().eq('id', orderId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete order error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
