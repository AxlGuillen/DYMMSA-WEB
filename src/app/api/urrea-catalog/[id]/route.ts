import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError, notFound, serverError } from '@/lib/api-helpers'
import { isUuid } from '@/lib/text'
import { parseCatalogItemInput, updateCatalogItem } from '@/lib/urrea-catalog-store'

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH /api/urrea-catalog/[id] — update a catalog item
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id } = await params
    const body = await request.json().catch(() => null)
    return NextResponse.json(await updateCatalogItem(supabase, id, parseCatalogItemInput(body, { create: false })))
  } catch (error) {
    return apiError(error, 'Error al actualizar el producto', 'URREA catalog update error:')
  }
}

// DELETE /api/urrea-catalog/[id] — delete a catalog item
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id } = await params
    if (!isUuid(id)) return notFound('Producto no encontrado')

    const { data, error } = await supabase.from('urrea_catalog').delete().eq('id', id).select('id')

    if (error) {
      console.error('Error deleting urrea_catalog item:', error)
      return serverError('Error al eliminar el producto')
    }

    // Zero rows deleted is a missing id, not a success (#157).
    if (!data || data.length === 0) return notFound('Producto no encontrado')

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('URREA catalog delete error:', error)
    return serverError('Error al eliminar el producto')
  }
}
