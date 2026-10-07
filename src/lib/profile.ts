/** Profile field rules shared by the self-service and admin routes (#122). */

import { avatarPublicUrl } from './avatar'
import { normalizeNss, nssError } from './nss'
import { parseRate } from './office-pay'
import type { Profile, ProfileArea, ProfileRole } from '@/types/database'

export const ROLE_LABELS: Record<ProfileRole, string> = { admin: 'Administrador', member: 'Miembro' }

export const AREA_LABELS: Record<ProfileArea, string> = { office: 'Oficina', workshop: 'Taller' }
export const AREAS: readonly ProfileArea[] = ['office', 'workshop']

export const PROFILE_COLUMNS = 'id, display_name, role, clock_employee_id, shift, nss, avatar_path, is_owner, area, created_at, updated_at'
/** Admin reads: the rate embedded from its admin-only table (review PR #137). */
export const PROFILE_WITH_PAY_COLUMNS = `${PROFILE_COLUMNS}, profile_pay(hourly_rate)`

/** PostgREST embeds a one-to-one as an object, but an array is tolerated in case the hint ever changes. */
export type PayEmbed = { hourly_rate: unknown } | { hourly_rate: unknown }[] | null

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

/** A profile row as the API sends it: avatar URL resolved and, when `profile_pay` was embedded, the rate flattened. */
export function presentProfile<T extends Pick<Profile, 'avatar_path'> & { profile_pay?: PayEmbed }>(
  row: T,
): Omit<T, 'profile_pay'> & { avatar_url: string | null; hourly_rate?: number | null } {
  const { profile_pay, ...rest } = row
  const embedded = Array.isArray(profile_pay) ? profile_pay[0] : profile_pay
  return {
    ...rest,
    ...('profile_pay' in row ? { hourly_rate: parseRate(embedded?.hourly_rate) } : {}),
    avatar_url: avatarPublicUrl(row.avatar_path),
  }
}

/** Admin input: null clears it (no estimate); anything else must be a positive amount. */
export function parseHourlyRate(input: unknown): Parsed<number | null> {
  if (input === null) return { value: null }
  const rate = parseRate(input)
  return rate === null ? { error: 'La tarifa por hora debe ser un monto mayor a 0' } : { value: rate }
}
