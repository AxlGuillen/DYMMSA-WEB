import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, serverError } from '@/lib/api-helpers'
import { DomainError } from '@/lib/domain-error'
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
    if (error instanceof DomainError) return NextResponse.json(error.body, { status: error.status })
    console.error('Product update error:', error)
    return serverError('Error al actualizar el producto')
  }
}

// DELETE /api/products/[id] — delete an ETM catalog product
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id } = await params

    const { error } = await supabase.from('etm_products').delete().eq('id', id)

    if (error) {
      console.error('Error deleting etm_product:', error)
      return serverError('Error al eliminar el producto')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Product delete error:', error)
    return serverError('Error al eliminar el producto')
  }
}
