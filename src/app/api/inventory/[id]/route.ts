import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, notFound, serverError } from '@/lib/api-helpers'
import type { StoreInventoryUpdate } from '@/types/database'

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH /api/inventory/[id] → actualizar producto de inventario
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id } = await params
    const body = (await request.json()) as StoreInventoryUpdate

    const updates: StoreInventoryUpdate = {}
    if (typeof body.model_code === 'string') {
      const modelCode = body.model_code.trim()
      if (!modelCode) return badRequest('El código modelo no puede estar vacío')
      updates.model_code = modelCode
    }
    if (body.quantity !== undefined) {
      if (typeof body.quantity !== 'number' || body.quantity < 0) return badRequest('La cantidad debe ser ≥ 0')
      updates.quantity = Math.trunc(body.quantity)
    }

    if (Object.keys(updates).length === 0) return badRequest('No hay cambios para aplicar')

    const { data, error } = await supabase
      .from('store_inventory')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return badRequest('Ya existe un producto con ese código modelo')
      if (error.code === 'PGRST116') return notFound('Producto no encontrado')
      console.error('Error updating store_inventory item:', error)
      return serverError('Error al actualizar el producto')
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Inventory update error:', error)
    return serverError('Error al actualizar el producto')
  }
}

// DELETE /api/inventory/[id] → eliminar producto de inventario
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id } = await params

    const { error } = await supabase.from('store_inventory').delete().eq('id', id)

    if (error) {
      console.error('Error deleting store_inventory item:', error)
      return serverError('Error al eliminar el producto')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Inventory delete error:', error)
    return serverError('Error al eliminar el producto')
  }
}
