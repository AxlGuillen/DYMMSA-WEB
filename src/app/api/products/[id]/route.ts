import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, notFound, serverError } from '@/lib/api-helpers'
import type { EtmProductUpdate } from '@/types/database'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** Columnas TEXT NOT NULL: se normalizan a cadena recortada (nunca null). */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// PATCH /api/products/[id] → actualizar producto del catálogo ETM
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id } = await params
    const body = (await request.json()) as EtmProductUpdate

    const updates: EtmProductUpdate = {}

    if (body.etm !== undefined) {
      const etm = typeof body.etm === 'string' ? body.etm.trim() : ''
      if (!etm) return badRequest('El ETM no puede estar vacío')
      updates.etm = etm
    }
    if (body.description !== undefined) updates.description = text(body.description)
    if (body.description_es !== undefined) updates.description_es = text(body.description_es)
    // Única columna de texto nullable: '' se guarda como null (celda vacía).
    if (body.dymmsa_description !== undefined) {
      updates.dymmsa_description = text(body.dymmsa_description) || null
    }
    if (body.model_code !== undefined) updates.model_code = text(body.model_code)
    if (body.brand !== undefined) updates.brand = text(body.brand)
    if (body.price !== undefined) {
      if (typeof body.price !== 'number' || !Number.isFinite(body.price)) {
        return badRequest('El precio debe ser un número')
      }
      updates.price = body.price
    }
    // is_sold es TRI-ESTADO: null (sin definir) / true / false. `undefined` =
    // no se toca; null explícito sí se persiste, así que no se puede usar
    // truthiness aquí.
    if (body.is_sold !== undefined) {
      if (body.is_sold !== null && typeof body.is_sold !== 'boolean') {
        return badRequest('is_sold debe ser true, false o null')
      }
      updates.is_sold = body.is_sold
    }

    if (Object.keys(updates).length === 0) return badRequest('No hay cambios para aplicar')

    const { data, error } = await supabase
      .from('etm_products')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return badRequest('Ya existe un producto con ese ETM')
      if (error.code === 'PGRST116') return notFound('Producto no encontrado')
      console.error('Error updating etm_product:', error)
      return serverError('Error al actualizar el producto')
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Product update error:', error)
    return serverError('Error al actualizar el producto')
  }
}

// DELETE /api/products/[id] → eliminar producto del catálogo ETM
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
