import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { normalizeBrandTag } from '@/lib/business-rules'
import { deleteBrand } from '@/lib/suppliers-store'

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

    await deleteBrand(supabase, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, 'Error al eliminar la marca', 'Brand delete error:')
  }
}
