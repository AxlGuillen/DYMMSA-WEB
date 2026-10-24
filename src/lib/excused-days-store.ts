/** Excused-day writes of /api/excused-days and the MCP's save_excused_day / delete_record (#155 C6). Admin only: the RLS is the gate. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DomainError, type DomainErrorKind } from '@/lib/domain-error'
import { isUuid } from '@/lib/text'
import { parseExcusedDay } from '@/lib/timesheet'
import type { ExcusedDay } from '@/types/database'

export class ExcusedDayError extends DomainError {
  constructor(message: string, kind: DomainErrorKind = 'invalid') {
    super(message, kind)
    this.name = 'ExcusedDayError'
  }
}

export const EXCUSED_COLUMNS = 'id, work_date, user_id, kind, note, created_by, created_at'

const ADMIN_ONLY = 'Solo un administrador puede justificar días'

/** The day already marked for this person (null = the whole team), if any. */
export async function findExcusedDay(db: SupabaseClient, date: string, userId: string | null): Promise<ExcusedDay | null> {
  let query = db.from('excused_days').select(EXCUSED_COLUMNS).eq('work_date', date)
  query = userId ? query.eq('user_id', userId) : query.is('user_id', null)
  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('Error reading excused day:', error)
    throw new ExcusedDayError('No se pudieron leer los días justificados', 'failed')
  }
  return (data as ExcusedDay | null) ?? null
}

/** POST /api/excused-days and save_excused_day: a holiday or an authorized early exit for the team or one person. */
export async function createExcusedDay(db: SupabaseClient, body: unknown): Promise<ExcusedDay> {
  const parsed = parseExcusedDay(body)
  if ('error' in parsed) throw new ExcusedDayError(parsed.error)
  if (parsed.value.user_id && !isUuid(parsed.value.user_id)) throw new ExcusedDayError('Persona inválida')

  const { data, error } = await db.from('excused_days').insert(parsed.value).select(EXCUSED_COLUMNS).single()
  if (error || !data) {
    if (error?.code === '23505') {
      throw new ExcusedDayError(parsed.value.user_id ? 'Ese día ya está justificado para esa persona' : 'Ese día ya está justificado para todo el equipo')
    }
    if (error?.code === '23503') throw new ExcusedDayError('La persona no existe')
    if (error?.code === '42501') throw new ExcusedDayError(ADMIN_ONLY, 'forbidden')
    console.error('Error creating excused day:', error)
    throw new ExcusedDayError('Error al guardar el día justificado', 'failed')
  }
  return data as ExcusedDay
}

/** Changes the kind or the note of a day already marked; the date and the person are its identity. */
export async function updateExcusedDay(db: SupabaseClient, id: string, changes: { kind: ExcusedDay['kind']; note: string | null }): Promise<ExcusedDay> {
  if (!isUuid(id)) throw new ExcusedDayError('El día justificado no existe', 'not_found')
  const { data, error } = await db.from('excused_days').update({ kind: changes.kind, note: changes.note }).eq('id', id).select(EXCUSED_COLUMNS)
  if (error) {
    if (error.code === '42501') throw new ExcusedDayError(ADMIN_ONLY, 'forbidden')
    console.error('Error updating excused day:', error)
    throw new ExcusedDayError('Error al guardar el día justificado', 'failed')
  }
  // RLS filters a non-admin's write to 0 rows without an error: report only what really happened (review PR #138).
  if (!data || data.length === 0) throw new ExcusedDayError(ADMIN_ONLY, 'forbidden')
  return data[0] as ExcusedDay
}

/** DELETE /api/excused-days/[id] and delete_record. */
export async function deleteExcusedDay(db: SupabaseClient, id: string): Promise<void> {
  if (!isUuid(id)) throw new ExcusedDayError('El día justificado no existe', 'not_found')
  const { data, error } = await db.from('excused_days').delete().eq('id', id).select('id')
  if (error) {
    console.error('Error deleting excused day:', error)
    throw new ExcusedDayError('Error al quitar el día justificado', 'failed')
  }
  // RLS hides a row from a non-admin: zero rows is "not there for you", never a silent success.
  if (!data || data.length === 0) throw new ExcusedDayError('El día justificado no existe', 'not_found')
}
