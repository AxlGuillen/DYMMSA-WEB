import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, notFound, badRequest, serverError } from '@/lib/api-helpers'
import type { OrderStatus } from '@/types/database'

const VALID_STATUSES: OrderStatus[] = [
  'ordered',
  'received',
  'delivered',
  'completed',
  'cancelled',
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
    if (!VALID_STATUSES.includes(status)) {
      return badRequest('Estado inválido')
    }

    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq('id', id)
      .single()

    if (!order) return notFound('Orden no encontrada')

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
