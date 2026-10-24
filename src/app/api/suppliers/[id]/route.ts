import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { isUuid } from '@/lib/text'
import { parseSupplierInput, updateSupplier } from '@/lib/suppliers-store'

// PATCH /api/suppliers/[id] — sparse updates + brandIds (replace by diff)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as { brandIds?: unknown }
    if (body.brandIds !== undefined && !Array.isArray(body.brandIds)) {
      return badRequest('brandIds debe ser un arreglo')
    }
    const parsed = parseSupplierInput(body, { requireName: false })
    if ('error' in parsed) return badRequest(parsed.error)

    await updateSupplier(supabase, id, parsed.value, body.brandIds as string[] | undefined)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, 'Error al actualizar el proveedor', 'Supplier update error:')
  }
}

// DELETE /api/suppliers/[id] — brand links fall by CASCADE
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error
    if (!isUuid(id)) return notFound('El proveedor no existe')

    const { data, error } = await supabase.from('suppliers').delete().eq('id', id).select('id')

    if (error) {
      // payables FK WITHOUT cascade (#84): the supplier still has invoices.
      if (error.code === '23503') {
        return badRequest('El proveedor tiene facturas por pagar registradas — elimínalas o reasígnalas primero')
      }
      console.error('Error deleting supplier:', error)
      return serverError('Error al eliminar el proveedor')
    }
    // Zero rows deleted is a missing id, not a success (#157).
    if (!data || data.length === 0) return notFound('El proveedor no existe')

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Supplier delete error:', error)
    return serverError('Error al eliminar el proveedor')
  }
}
