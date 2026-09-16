import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, notFound, serverError } from '@/lib/api-helpers'
import type { Profile, ProfileRole, ProfileUpdate } from '@/types/database'

const ROLES: ProfileRole[] = ['admin', 'member']

// PATCH /api/profiles/[id] — display name, role, clock id (admin)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as ProfileUpdate
    const updates: Record<string, unknown> = {}

    if (body.display_name !== undefined) {
      const name = typeof body.display_name === 'string' ? body.display_name.trim() : ''
      if (!name) return badRequest('El nombre no puede quedar vacío')
      updates.display_name = name
    }
    if (body.role !== undefined) {
      if (!ROLES.includes(body.role as ProfileRole)) return badRequest('Rol inválido')
      updates.role = body.role
    }
    if (body.clock_employee_id !== undefined) {
      const cid = body.clock_employee_id
      if (cid !== null && (!Number.isInteger(cid) || (cid as number) < 1)) {
        return badRequest('El id del checador debe ser un entero mayor a 0')
      }
      updates.clock_employee_id = cid
    }
    if (Object.keys(updates).length === 0) return badRequest('No hay cambios para guardar')

    const { data: current } = await supabase
      .from('profiles').select('id, role').eq('id', id).single()
    if (!current) return notFound('El perfil no existe')

    // Never leave the team without an admin.
    if (updates.role === 'member' && (current as Pick<Profile, 'role'>).role === 'admin') {
      const { count } = await supabase
        .from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
      if ((count ?? 0) <= 1) return badRequest('Debe quedar al menos un administrador')
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .select('id, display_name, role, clock_employee_id, created_at, updated_at')
      .single()

    if (error || !data) {
      if (error?.code === '23505') return badRequest('Ese id de checador ya está asignado a otro usuario')
      if (error?.code === 'PGRST116') return notFound('El perfil no existe')
      console.error('Error updating profile:', error)
      return serverError('Error al actualizar el perfil')
    }
    return NextResponse.json(data)
  } catch (error) {
    console.error('Profile PATCH error:', error)
    return serverError('Error al actualizar el perfil')
  }
}
