import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, notFound, badRequest, serverError } from '@/lib/api-helpers'
import type { OrderStatus } from '@/types/database'

// 'cancelled' only through /cancel: it is the one that returns the stock, and DELETE relies on it (ADR-010).
const MANUAL_ORDER_STATUSES: OrderStatus[] = [
  'ordered',
  'received',
  'delivered',
  'completed',
]

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { status } = await request.json()
    if (status === 'cancelled') {
      return badRequest('Para cancelar usa "Cancelar orden": es la que restaura el inventario')
    }
    if (!MANUAL_ORDER_STATUSES.includes(status)) {
      return badRequest('Estado inválido')
    }

    const { data: order } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', id)
      .single()

    // oxlint-disable-next-line react-doctor/nextjs-no-redirect-in-try-catch -- custom notFound() helper returns a NextResponse, not Next navigation
    if (!order) return notFound('Orden no encontrada')

    if (order.status === 'cancelled') {
      return badRequest('Una orden cancelada ya no cambia de estado')
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update order status error:', error)
      return serverError('Error al actualizar el estado')
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('PATCH order status error:', error)
    return serverError()
  }
}
