/** Profile writes shared by PATCH /api/profile, PATCH /api/profiles/[id] and the MCP's save_profile (#155 D). The role
 *  guard (last admin) and the pay table live here, so a caller cannot skip them. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DomainError, type DomainErrorKind } from '@/lib/domain-error'
import { AREAS, LAST_ADMIN_MESSAGE, PROFILE_COLUMNS, parseDisplayName, parseHourlyRate, parseNss } from '@/lib/profile'
import type { OwnProfileUpdate, Profile, ProfileArea, ProfileRole, ProfileShift, ProfileUpdate } from '@/types/database'

export class ProfileError extends DomainError {
  constructor(message: string, kind: DomainErrorKind = 'invalid') {
    super(message, kind)
    this.name = 'ProfileError'
  }
}

// No hourly_rate: pay amounts are never shown to the person (2026-10-05).
export const OWN_PROFILE_COLUMNS = 'id, display_name, role, clock_employee_id, shift, nss, avatar_path, is_owner, area'
const OWN_EDITABLE = new Set<keyof OwnProfileUpdate>(['display_name', 'nss'])
const ROLES: ProfileRole[] = ['admin', 'member']
const SHIFTS: ProfileShift[] = ['full_time', 'part_time']

/** PATCH /api/profile: the caller's own name and NSS; the row comes back without the rate. */
export async function updateOwnProfile(db: SupabaseClient, userId: string, body: unknown): Promise<Omit<Profile, 'created_at' | 'updated_at'>> {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (Object.keys(raw).some((key) => !OWN_EDITABLE.has(key as keyof OwnProfileUpdate))) {
    throw new ProfileError('Solo puedes editar tu nombre y tu NSS; lo demás lo cambia un administrador')
  }
  const updates: OwnProfileUpdate = {}
  if (raw.display_name !== undefined) {
    const name = parseDisplayName(raw.display_name)
    if ('error' in name) throw new ProfileError(name.error)
    updates.display_name = name.value
  }
  if (raw.nss !== undefined) {
    const nss = parseNss(raw.nss)
    if ('error' in nss) throw new ProfileError(nss.error)
    updates.nss = nss.value
  }
  if (Object.keys(updates).length === 0) throw new ProfileError('No hay cambios para guardar')

  const { data, error } = await db.from('profiles').update(updates).eq('id', userId).select(OWN_PROFILE_COLUMNS).single()
  if (error || !data) {
    if (error?.code === 'PGRST116') throw new ProfileError('Tu perfil no existe', 'not_found')
    console.error('Error updating own profile:', error)
    throw new ProfileError('Error al actualizar tu perfil', 'failed')
  }
  return data as Omit<Profile, 'created_at' | 'updated_at'>
}

/** What an admin edit of one person validates to: the profile columns, and the rate apart (its own table). */
export interface AdminProfileChange {
  updates: Record<string, unknown>
  rate?: { value: number | null }
}

/** The admin body as columns; nothing is written. A field the caller does not send is not touched. */
export function parseAdminProfileUpdate(body: ProfileUpdate): AdminProfileChange {
  const updates: Record<string, unknown> = {}
  if (body.display_name !== undefined) {
    const name = parseDisplayName(body.display_name)
    if ('error' in name) throw new ProfileError(name.error)
    updates.display_name = name.value
  }
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role as ProfileRole)) throw new ProfileError('Rol inválido')
    updates.role = body.role
  }
  if (body.clock_employee_id !== undefined) {
    const cid = body.clock_employee_id
    if (cid !== null && (!Number.isInteger(cid) || (cid as number) < 1)) throw new ProfileError('El id del checador debe ser un entero mayor a 0')
    updates.clock_employee_id = cid
  }
  if (body.shift !== undefined) {
    if (body.shift !== null && !SHIFTS.includes(body.shift as ProfileShift)) throw new ProfileError('Jornada inválida')
    updates.shift = body.shift
  }
  if (body.nss !== undefined) {
    const nss = parseNss(body.nss)
    if ('error' in nss) throw new ProfileError(nss.error)
    updates.nss = nss.value
  }
  if (body.area !== undefined) {
    if (!AREAS.includes(body.area as ProfileArea)) throw new ProfileError('Área inválida: oficina o taller')
    updates.area = body.area
  }
  // The rate lives in profile_pay, admin-only (review PR #137): never a column of the row the person reads.
  let rate: AdminProfileChange['rate']
  if (body.hourly_rate !== undefined) {
    const parsed = parseHourlyRate(body.hourly_rate)
    if ('error' in parsed) throw new ProfileError(parsed.error)
    rate = { value: parsed.value }
  }
  if (Object.keys(updates).length === 0 && !rate) throw new ProfileError('No hay cambios para guardar')
  return { updates, rate }
}

/**
 * PATCH /api/profiles/[id] and save_profile: validates, keeps at least one admin, writes the columns and, apart, the
 * rate. `select` is what comes back: the route asks for the pay embed, the MCP never does (the rate does not travel).
 */
export async function updateProfileAsAdmin(db: SupabaseClient, id: string, body: ProfileUpdate, select: string = PROFILE_COLUMNS): Promise<unknown> {
  const { updates, rate } = parseAdminProfileUpdate(body)

  const { data: current } = await db.from('profiles').select('id, role').eq('id', id).single()
  if (!current) throw new ProfileError('El perfil no existe', 'not_found')

  // Never leave the team without an admin; the profiles_guard_last_admin trigger backs it (#157).
  if (updates.role === 'member' && (current as Pick<Profile, 'role'>).role === 'admin') {
    const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
    if ((count ?? 0) <= 1) throw new ProfileError(LAST_ADMIN_MESSAGE)
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await db.from('profiles').update(updates).eq('id', id)
    if (error) {
      if (error.code === '23505') throw new ProfileError('Ese id de checador ya está asignado a otro usuario')
      if (error.code === '23514' && error.message.includes(LAST_ADMIN_MESSAGE)) throw new ProfileError(LAST_ADMIN_MESSAGE)
      console.error('Error updating profile:', error)
      throw new ProfileError('Error al actualizar el perfil', 'failed')
    }
  }
  if (rate) {
    // null = no estimate = no row; the CHECK (> 0) makes a stored 0 impossible.
    const { error } =
      rate.value === null
        ? await db.from('profile_pay').delete().eq('profile_id', id)
        : await db.from('profile_pay').upsert({ profile_id: id, hourly_rate: rate.value }, { onConflict: 'profile_id' })
    if (error) {
      console.error('Error updating profile pay:', error)
      // Two writes, no transaction: the profile part may already be saved, so the message says so.
      const saved = Object.keys(updates).length > 0 ? 'El perfil se guardó, pero la tarifa por hora no' : 'Error al actualizar la tarifa por hora'
      throw new ProfileError(saved, 'failed')
    }
  }

  const { data, error } = await db.from('profiles').select(select).eq('id', id).single()
  if (error || !data) {
    if (error?.code === 'PGRST116') throw new ProfileError('El perfil no existe', 'not_found')
    console.error('Error reading profile:', error)
    throw new ProfileError('Error al actualizar el perfil', 'failed')
  }
  return data
}
