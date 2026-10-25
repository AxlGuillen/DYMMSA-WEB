import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError, notFound, serverError } from '@/lib/api-helpers'
import { updateInventoryItem } from '@/lib/inventory-store'
import { isUuid } from '@/lib/text'

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH /api/inventory/[id] — update an inventory item
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id } = await params
    return NextResponse.json(await updateInventoryItem(supabase, id, await request.json()))
  } catch (error) {
    return apiError(error, 'Error al actualizar el producto', 'Inventory update error:')
  }
}

// DELETE /api/inventory/[id] — delete an inventory item
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id } = await params
    if (!isUuid(id)) return notFound('Producto no encontrado')

    const { data, error } = await supabase.from('store_inventory').delete().eq('id', id).select('id')

    if (error) {
      console.error('Error deleting store_inventory item:', error)
      return serverError('Error al eliminar el producto')
    }
    // Zero rows deleted is a missing id, not a success (#157).
    if (!data || data.length === 0) return notFound('Producto no encontrado')

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Inventory delete error:', error)
    return serverError('Error al eliminar el producto')
  }
}
