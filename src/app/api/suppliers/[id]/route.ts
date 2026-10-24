import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError, badRequest } from '@/lib/api-helpers'
import { deleteSupplier, parseSupplierInput, updateSupplier } from '@/lib/suppliers-store'

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

    await deleteSupplier(supabase, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, 'Error al eliminar el proveedor', 'Supplier delete error:')
  }
}
