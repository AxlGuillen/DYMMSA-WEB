/**
 * Mi perfil (#122), read-only. Like hours, no permission logic here: RLS on profiles lets a
 * member see only their own row and an admin the whole team.
 */

import { ToolError, requireSingleMatch, sanitizeSearch, type Db } from '../shared'
import { avatarPublicUrl } from '@/lib/avatar'
import { ROLE_LABELS } from '@/lib/profile'
import { SHIFT_LABELS } from '@/lib/timesheet'
import type { Profile } from '@/types/database'

/** The caller themself, or (admins only, by RLS) the one person whose name matches `persona`. */
export async function resolvePerson<T extends Pick<Profile, 'id' | 'display_name'>>(
  db: Db,
  callerId: string,
  persona: string | undefined,
  columns: string,
): Promise<T> {
  const query = sanitizeSearch(persona ?? '')
  if (!query) {
    const { data, error } = await db.from('profiles').select(columns).eq('id', callerId).single()
    if (error || !data) throw new ToolError('No encontré tu perfil. Vuelve a conectar el conector.')
    return data as unknown as T
  }
  const { data, error } = await db
    .from('profiles')
    .select(columns)
    .ilike('display_name', `%${query}%`)
    // One past the cap so "more than 5" can be said instead of a wrong count.
    .limit(6)
  if (error) throw new ToolError('No se pudieron leer los perfiles')
  const matches = (data ?? []) as unknown as T[]
  if (matches.length === 0) {
    throw new ToolError(`Ninguna persona visible para ti coincide con "${query}". Un miembro solo puede consultar lo suyo.`)
  }
  return requireSingleMatch(matches, (m) => m.display_name, 'persona', query)
}

type ProfileRow = Pick<Profile, 'id' | 'display_name' | 'role' | 'clock_employee_id' | 'shift' | 'nss' | 'avatar_path' | 'is_owner'>

const COLUMNS = 'id, display_name, role, clock_employee_id, shift, nss, avatar_path, is_owner'

function digest(row: ProfileRow, withNss: boolean) {
  return {
    nombre: row.display_name,
    rol: ROLE_LABELS[row.role],
    dueno_del_negocio: row.is_owner,
    jornada: row.shift ? SHIFT_LABELS[row.shift] : null,
    id_checador: row.clock_employee_id,
    ...(withNss ? { nss: row.nss } : {}),
    foto: avatarPublicUrl(row.avatar_path),
  }
}

const NSS_NOTE = 'El NSS de los demás solo viaja al pedir a una persona por nombre.'

export async function getProfiles(db: Db, callerId: string, input: { persona?: string } = {}) {
  if (sanitizeSearch(input.persona ?? '')) {
    const person = await resolvePerson<ProfileRow>(db, callerId, input.persona, COLUMNS)
    return { total: 1, perfiles: [digest(person, true)], nota: null }
  }
  const { data, error } = await db.from('profiles').select(COLUMNS).order('display_name', { ascending: true })
  if (error) throw new ToolError('No se pudieron leer los perfiles')
  const rows = (data ?? []) as ProfileRow[]
  // A team listing never dumps everyone's NSS (review PR #126); the caller's own stays.
  return {
    total: rows.length,
    perfiles: rows.map((row) => digest(row, row.id === callerId)),
    nota: rows.length > 1 ? NSS_NOTE : null,
  }
}
