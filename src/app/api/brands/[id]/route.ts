import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { normalizeBrandTag } from '@/lib/business-rules'
import { isUuid } from '@/lib/text'

// PATCH /api/brands/[id] — rename (normalized trim+upper)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as { name?: unknown }
    const name = typeof body.name === 'string' ? normalizeBrandTag(body.name) : ''
    if (!name) return badRequest('El nombre de la marca es obligatorio')

    const { error } = await supabase
      .from('brands')
      .update({ name })
      .eq('id', id)
      .select('id')
      .single()

    if (error) {
      if (error.code === 'PGRST116') return notFound('Marca no encontrada')
      if (error.code === '23505') return badRequest('Ya existe una marca con ese nombre')
      console.error('Error renaming brand:', error)
      return serverError('Error al renombrar la marca')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Brand rename error:', error)
    return serverError('Error al renombrar la marca')
  }
}

// DELETE /api/brands/[id] — blocked while the brand is assigned to suppliers
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error
    if (!isUuid(id)) return notFound('Marca no encontrada')

    // Pre-check for a friendly message; the FK without CASCADE is the backstop.
    const { count, error: countError } = await supabase
      .from('supplier_brands')
      .select('*', { count: 'exact', head: true })
      .eq('brand_id', id)

    if (countError) {
      console.error('Error checking brand usage:', countError)
      return serverError('Error al verificar el uso de la marca')
    }
    if ((count ?? 0) > 0) {
      return badRequest(
        `La marca está asignada a ${count} proveedor${count !== 1 ? 'es' : ''}. Quítala de sus proveedores antes de eliminarla.`,
      )
    }

    const { data, error } = await supabase.from('brands').delete().eq('id', id).select('id')

    if (error) {
      // 23503: the FK blocked it (race between the pre-check and the delete).
      if (error.code === '23503') {
        return badRequest('La marca está asignada a proveedores. Quítala antes de eliminarla.')
      }
      console.error('Error deleting brand:', error)
      return serverError('Error al eliminar la marca')
    }
    // Zero rows deleted is a missing id, not a success (#157).
    if (!data || data.length === 0) return notFound('Marca no encontrada')

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Brand delete error:', error)
    return serverError('Error al eliminar la marca')
  }
}
