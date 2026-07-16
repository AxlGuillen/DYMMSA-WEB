import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, notFound, serverError } from '@/lib/api-helpers'
import type { SupplierUpdate } from '@/types/database'

interface UpdateSupplierBody extends SupplierUpdate {
  brandIds?: string[]
}

// PATCH /api/suppliers/[id] → updates sparse + brandIds (replace por diff)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as UpdateSupplierBody
    if (body.brandIds !== undefined && !Array.isArray(body.brandIds)) {
      return badRequest('brandIds debe ser un arreglo')
    }

    const updates: SupplierUpdate = {}
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return badRequest('El nombre del proveedor no puede quedar vacío')
      updates.name = name
    }
    for (const field of ['phone', 'whatsapp', 'email', 'address', 'notes'] as const) {
      if (body[field] !== undefined) {
        updates[field] = typeof body[field] === 'string' ? body[field].trim() || null : null
      }
    }

    if (Object.keys(updates).length === 0 && body.brandIds === undefined) {
      return badRequest('No hay cambios para guardar')
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from('suppliers')
        .update(updates)
        .eq('id', id)
        .select('id')
        .single()

      if (error) {
        if (error.code === 'PGRST116') return notFound('Proveedor no encontrado')
        if (error.code === '23505') return badRequest('Ya existe un proveedor con ese nombre')
        console.error('Error updating supplier:', error)
        return serverError('Error al actualizar el proveedor')
      }
    }

    // ── Marcas: replace por DIFF (no destructivo — nunca hay ventana sin links) ──
    if (body.brandIds !== undefined) {
      const desired = [...new Set(body.brandIds)]

      const { data: existing, error: linksError } = await supabase
        .from('supplier_brands')
        .select('brand_id')
        .eq('supplier_id', id)

      if (linksError) {
        console.error('Error reading supplier brands:', linksError)
        return serverError('Error al actualizar las marcas del proveedor')
      }

      const current = new Set((existing ?? []).map((l) => l.brand_id))
      const toInsert = desired.filter((brandId) => !current.has(brandId))
      const toDelete = [...current].filter((brandId) => !desired.includes(brandId))

      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('supplier_brands')
          .insert(toInsert.map((brand_id) => ({ supplier_id: id, brand_id })))
        if (insertError) {
          console.error('Error inserting supplier brands:', insertError)
          return serverError('Error al asignar marcas')
        }
      }
      if (toDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('supplier_brands')
          .delete()
          .eq('supplier_id', id)
          .in('brand_id', toDelete)
        if (deleteError) {
          console.error('Error removing supplier brands:', deleteError)
          return serverError('Error al quitar marcas')
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Supplier update error:', error)
    return serverError('Error al actualizar el proveedor')
  }
}

// DELETE /api/suppliers/[id] → elimina (los links caen por CASCADE)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { error } = await supabase.from('suppliers').delete().eq('id', id)

    if (error) {
      console.error('Error deleting supplier:', error)
      return serverError('Error al eliminar el proveedor')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Supplier delete error:', error)
    return serverError('Error al eliminar el proveedor')
  }
}
