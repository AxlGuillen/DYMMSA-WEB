import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { normalizeCatalogCode } from '@/lib/business-rules'
import type { UrreaCatalogUpdate } from '@/types/database'

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH /api/urrea-catalog/[id] → actualizar producto
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id } = await params
    const body = (await request.json()) as UrreaCatalogUpdate

    const updates: UrreaCatalogUpdate = {}
    if (typeof body.code === 'string') {
      const code = normalizeCatalogCode(body.code)
      if (!code) return badRequest('El código no puede estar vacío')
      updates.code = code
    }
    if (body.description !== undefined) updates.description = body.description?.trim() || null
    if (body.std !== undefined) {
      if (typeof body.std !== 'number' || body.std < 1) return badRequest('STD debe ser un entero ≥ 1')
      updates.std = body.std
    }
    if (body.price !== undefined) updates.price = typeof body.price === 'number' ? body.price : null

    if (Object.keys(updates).length === 0) return badRequest('No hay cambios para aplicar')

    const { data, error } = await supabase
      .from('urrea_catalog')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return badRequest('Ya existe un producto con ese código')
      if (error.code === 'PGRST116') return notFound('Producto no encontrado')
      console.error('Error updating urrea_catalog item:', error)
      return serverError('Error al actualizar el producto')
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('URREA catalog update error:', error)
    return serverError('Error al actualizar el producto')
  }
}

// DELETE /api/urrea-catalog/[id] → eliminar producto
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id } = await params

    const { error } = await supabase.from('urrea_catalog').delete().eq('id', id)

    if (error) {
      console.error('Error deleting urrea_catalog item:', error)
      return serverError('Error al eliminar el producto')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('URREA catalog delete error:', error)
    return serverError('Error al eliminar el producto')
  }
}
