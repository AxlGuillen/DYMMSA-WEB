import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { todayInMexico } from '@/lib/format'
import { parsePayableUpdate } from '@/lib/payables'

// PATCH /api/payables/[id] — sparse updates
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const parsed = parsePayableUpdate(await request.json(), todayInMexico())
    if (!parsed.ok) return badRequest(parsed.error)
    const { updates } = parsed
    if (Object.keys(updates).length === 0) return badRequest('No hay cambios para guardar')

    if (updates.supplier_id !== undefined) {
      const { data: supplier } = await supabase
        .from('suppliers').select('id').eq('id', updates.supplier_id).single()
      if (!supplier) return notFound('El proveedor no existe')
    }

    const { data, error } = await supabase
      .from('payables')
      .update(updates)
      .eq('id', id)
      .select('*, supplier:suppliers(id, name, payment_terms_days)')
      .single()

    if (error || !data) {
      if (error?.code === 'PGRST116') return notFound('La factura no existe')
      console.error('Error updating payable:', error)
      return serverError('Error al actualizar la factura')
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Payable PATCH error:', error)
    return serverError('Error al actualizar la factura')
  }
}

// DELETE /api/payables/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { error } = await supabase.from('payables').delete().eq('id', id)

    if (error) {
      console.error('Error deleting payable:', error)
      return serverError('Error al eliminar la factura')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Payable DELETE error:', error)
    return serverError('Error al eliminar la factura')
  }
}
