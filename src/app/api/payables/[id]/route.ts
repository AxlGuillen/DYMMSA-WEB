import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, serverError } from '@/lib/api-helpers'
import { todayInMexico } from '@/lib/format'
import { DomainError } from '@/lib/domain-error'
import { deletePayable, updatePayable } from '@/lib/payables-store'

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

    return NextResponse.json(await updatePayable(supabase, id, await request.json(), todayInMexico()))
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json(error.body, { status: error.status })
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

    await deletePayable(supabase, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json(error.body, { status: error.status })
    console.error('Payable DELETE error:', error)
    return serverError('Error al eliminar la factura')
  }
}
