import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, notFound, serverError, isUuid } from '@/lib/api-helpers'
import { AREAS, PROFILE_WITH_PAY_COLUMNS, parseDisplayName, parseHourlyRate, parseNss, presentProfile, type PayEmbed } from '@/lib/profile'
import type { Profile, ProfileArea, ProfileRole, ProfileShift, ProfileUpdate } from '@/types/database'

const ROLES: ProfileRole[] = ['admin', 'member']
const SHIFTS: ProfileShift[] = ['full_time', 'part_time']

// PATCH /api/profiles/[id] — display name, role, clock id, shift, area, NSS, hourly rate (admin)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error
    if (!isUuid(id)) return notFound('El perfil no existe')

    const body = (await request.json()) as ProfileUpdate
    const updates: Record<string, unknown> = {}

    if (body.display_name !== undefined) {
      const name = parseDisplayName(body.display_name)
      if ('error' in name) return badRequest(name.error)
      updates.display_name = name.value
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
    if (body.shift !== undefined) {
      if (body.shift !== null && !SHIFTS.includes(body.shift as ProfileShift)) return badRequest('Jornada inválida')
      updates.shift = body.shift
    }
    if (body.nss !== undefined) {
      const nss = parseNss(body.nss)
      if ('error' in nss) return badRequest(nss.error)
      updates.nss = nss.value
    }
    if (body.area !== undefined) {
      if (!AREAS.includes(body.area as ProfileArea)) return badRequest('Área inválida: oficina o taller')
      updates.area = body.area
    }
    // The rate lives in profile_pay, admin-only (review PR #137): never a column of the row the person reads.
    let rateChange: { value: number | null } | undefined
    if (body.hourly_rate !== undefined) {
      const rate = parseHourlyRate(body.hourly_rate)
      if ('error' in rate) return badRequest(rate.error)
      rateChange = { value: rate.value }
    }
    if (Object.keys(updates).length === 0 && !rateChange) return badRequest('No hay cambios para guardar')

    const { data: current } = await supabase
      .from('profiles').select('id, role').eq('id', id).single()
    if (!current) return notFound('El perfil no existe')

    // Never leave the team without an admin.
    if (updates.role === 'member' && (current as Pick<Profile, 'role'>).role === 'admin') {
      const { count } = await supabase
        .from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
      if ((count ?? 0) <= 1) return badRequest('Debe quedar al menos un administrador')
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('profiles').update(updates).eq('id', id)
      if (error) {
        if (error.code === '23505') return badRequest('Ese id de checador ya está asignado a otro usuario')
        console.error('Error updating profile:', error)
        return serverError('Error al actualizar el perfil')
      }
    }
    if (rateChange) {
      // null = no estimate = no row; the CHECK (> 0) makes a stored 0 impossible.
      const { error } =
        rateChange.value === null
          ? await supabase.from('profile_pay').delete().eq('profile_id', id)
          : await supabase.from('profile_pay').upsert({ profile_id: id, hourly_rate: rateChange.value }, { onConflict: 'profile_id' })
      if (error) {
        console.error('Error updating profile pay:', error)
        return serverError('Error al actualizar la tarifa por hora')
      }
    }

    const { data, error } = await supabase.from('profiles').select(PROFILE_WITH_PAY_COLUMNS).eq('id', id).single()
    if (error || !data) {
      if (error?.code === 'PGRST116') return notFound('El perfil no existe')
      console.error('Error reading profile:', error)
      return serverError('Error al actualizar el perfil')
    }
    return NextResponse.json(presentProfile(data as Profile & { profile_pay: PayEmbed }))
  } catch (error) {
    console.error('Profile PATCH error:', error)
    return serverError('Error al actualizar el perfil')
  }
}
