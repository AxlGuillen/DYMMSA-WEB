/**
 * Mi perfil (#122), read-only. Like hours, no permission logic here: RLS on profiles lets a
 * member see only their own row and an admin the whole team.
 */

import { ToolError } from '@/lib/mcp/core/errors'
import { listResult, refOf } from '@/lib/mcp/core/envelope'
import { resolveByName } from '@/lib/mcp/core/lookup'
import { sanitizeSearch } from '@/lib/text'
import type { Db } from '@/lib/mcp/core/db'
import { avatarPublicUrl } from '@/lib/avatar'
import { AREA_TOKENS, ROLE_TOKENS } from '@/lib/profile'
import { SHIFT_TOKENS } from '@/lib/timesheet'
import type { Profile } from '@/types/database'

/** The caller themself, or (admins only, by RLS) the one person whose ref or name matches `persona`. */
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
  return resolveByName<T>(
    db,
    {
      table: 'profiles',
      select: columns,
      what: 'persona',
      article: 'la',
      label: (m) => m.display_name,
      search: async (client, text) => {
        const { data, error } = await client
          .from('profiles')
          .select(columns)
          .ilike('display_name', `%${text}%`)
          // One past the cap so "more than 5" can be said instead of a wrong count.
          .limit(6)
        if (error) throw new ToolError('No se pudieron leer los perfiles')
        return (data ?? []) as unknown as T[]
      },
      notFound: (text) => `Ninguna persona visible para ti coincide con "${text}". Un miembro solo puede consultar lo suyo.`,
    },
    query,
  )
}

type ProfileRow = Pick<Profile, 'id' | 'display_name' | 'role' | 'area' | 'clock_employee_id' | 'shift' | 'nss' | 'avatar_path' | 'is_owner'>

const COLUMNS = 'id, display_name, role, area, clock_employee_id, shift, nss, avatar_path, is_owner'

function digest(row: ProfileRow, withNss: boolean) {
  return {
    ref: refOf(row.id),
    nombre: row.display_name,
    rol: ROLE_TOKENS.toToken(row.role),
    dueno_del_negocio: row.is_owner,
    area: AREA_TOKENS.toToken(row.area),
    jornada: row.shift ? SHIFT_TOKENS.toToken(row.shift) : null,
    id_checador: row.clock_employee_id,
    ...(withNss ? { nss: row.nss } : {}),
    foto: avatarPublicUrl(row.avatar_path),
  }
}

const NSS_NOTE = 'El NSS de los demás solo viaja al pedir a una persona por nombre.'

/** The team is a short list: one page, whole. */
const whole = (count: number) => ({ total: count, pagina: 1, por_pagina: Math.max(count, 1) })

export async function listProfiles(db: Db, callerId: string, input: { persona?: string } = {}) {
  if (sanitizeSearch(input.persona ?? '')) {
    const person = await resolvePerson<ProfileRow>(db, callerId, input.persona, COLUMNS)
    return listResult('perfiles', [digest(person, true)], whole(1))
  }
  const { data, error } = await db.from('profiles').select(COLUMNS).order('display_name', { ascending: true })
  if (error) throw new ToolError('No se pudieron leer los perfiles')
  const rows = (data ?? []) as ProfileRow[]
  // A team listing never dumps everyone's NSS (review PR #126); the caller's own stays.
  return listResult(
    'perfiles',
    rows.map((row) => digest(row, row.id === callerId)),
    whole(rows.length),
    rows.length > 1 ? NSS_NOTE : null,
  )
}
