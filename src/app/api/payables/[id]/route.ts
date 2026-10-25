import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { todayInMexico } from '@/lib/format'
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
    return apiError(error, 'Error al actualizar la factura', 'Payable PATCH error:')
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
    return apiError(error, 'Error al eliminar la factura', 'Payable DELETE error:')
  }
}
