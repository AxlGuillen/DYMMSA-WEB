/** Profile field rules shared by the self-service and admin routes (#122). */

import { avatarPublicUrl } from './avatar'
import { normalizeNss, nssError } from './nss'
import type { Profile } from '@/types/database'

export const PROFILE_COLUMNS = 'id, display_name, role, clock_employee_id, shift, nss, avatar_path, created_at, updated_at'

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

export function withAvatarUrl<T extends Pick<Profile, 'avatar_path'>>(row: T): T & { avatar_url: string | null } {
  return { ...row, avatar_url: avatarPublicUrl(row.avatar_path) }
}
