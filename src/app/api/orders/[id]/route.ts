import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

// PATCH — Update order metadata (odoo_id)
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ message: 'No autorizado' }, { status: 401 })

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
