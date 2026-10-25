import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError, notFound, serverError } from '@/lib/api-helpers'
import { isUuid } from '@/lib/text'
import { parseProductInput, updateProduct } from '@/lib/products-store'

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH /api/products/[id] — update an ETM catalog product
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id } = await params
    const body = await request.json().catch(() => null)
    return NextResponse.json(await updateProduct(supabase, id, parseProductInput(body, { create: false })))
  } catch (error) {
    return apiError(error, 'Error al actualizar el producto', 'Product update error:')
  }
}

// DELETE /api/products/[id] — delete an ETM catalog product
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id } = await params
    if (!isUuid(id)) return notFound('Producto no encontrado')

    const { data, error } = await supabase.from('etm_products').delete().eq('id', id).select('id')

    if (error) {
      console.error('Error deleting etm_product:', error)
      return serverError('Error al eliminar el producto')
    }

    // Zero rows deleted is a missing id, not a success (#157).
    if (!data || data.length === 0) return notFound('Producto no encontrado')

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Product delete error:', error)
    return serverError('Error al eliminar el producto')
  }
}
