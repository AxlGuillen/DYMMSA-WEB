/** Profile field rules shared by the self-service and admin routes (#122). */

import { avatarPublicUrl } from './avatar'
import { normalizeNss, nssError } from './nss'
import { parseRate } from './office-pay'
import type { Profile, ProfileArea, ProfileRole } from '@/types/database'

export const ROLE_LABELS: Record<ProfileRole, string> = { admin: 'Administrador', member: 'Miembro' }

export const AREA_LABELS: Record<ProfileArea, string> = { office: 'Oficina', workshop: 'Taller' }
export const AREAS: readonly ProfileArea[] = ['office', 'workshop']

export const PROFILE_COLUMNS = 'id, display_name, role, clock_employee_id, shift, nss, avatar_path, is_owner, hourly_rate, area, created_at, updated_at'

type Parsed<T> = { value: T } | { error: string }

export function parseDisplayName(input: unknown): Parsed<string> {
  const name = typeof input === 'string' ? input.trim() : ''
  if (!name) return { error: 'El nombre no puede quedar vacío' }
  if (name.length > 80) return { error: 'El nombre no puede pasar de 80 caracteres' }
  return { value: name }
}

/** Empty or null clears it; anything else must be a valid NSS. */
export function parseNss(input: unknown): Parsed<string | null> {
  if (input === null) return { value: null }
  if (typeof input !== 'string') return { error: 'El NSS debe ser texto' }
  const nss = normalizeNss(input)
  if (!nss) return { value: null }
  const error = nssError(nss)
  return error ? { error } : { value: nss }
}

/** A profile row as the API sends it: avatar URL resolved and the numeric rate coerced. */
export function presentProfile<T extends Pick<Profile, 'avatar_path'> & { hourly_rate?: unknown }>(row: T): T & { avatar_url: string | null } {
  return {
    ...row,
    ...('hourly_rate' in row ? { hourly_rate: parseRate(row.hourly_rate) } : {}),
    avatar_url: avatarPublicUrl(row.avatar_path),
  }
}

/** Admin input: null clears it (no estimate); anything else must be a positive amount. */
export function parseHourlyRate(input: unknown): Parsed<number | null> {
  if (input === null) return { value: null }
  const rate = parseRate(input)
  return rate === null ? { error: 'La tarifa por hora debe ser un monto mayor a 0' } : { value: rate }
}
