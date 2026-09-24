/**
 * Hours module, read-only (#101, ADR-029). No permission logic here on purpose: the db comes
 * from the caller's token, so RLS decides — a member sees only their own rows and profile.
 */

import { ToolError, sanitizeSearch, type Db } from '../shared'
import { todayInMexico } from '@/lib/format'
import {
  buildWeekView,
  buildWeeklyTrend,
  formatDuration,
  normalizeEntryTimes,
  shiftProgress,
  SHIFT_HOURS,
  SHIFT_LABELS,
  weekBounds,
  shiftWeek,
} from '@/lib/timesheet'
import type { Profile, TimeEntry } from '@/types/database'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

type Target = Pick<Profile, 'id' | 'display_name' | 'shift'>

/** The caller themself, or (admins only, by RLS) the one person whose name matches `persona`. */
async function resolveTarget(db: Db, callerId: string, persona?: string): Promise<Target> {
  const query = sanitizeSearch(persona ?? '')
  if (!query) {
    const { data, error } = await db.from('profiles').select('id, display_name, shift').eq('id', callerId).single()
    if (error || !data) throw new ToolError('No encontré tu perfil. Vuelve a conectar el conector.')
    return data as Target
  }
  const { data, error } = await db
    .from('profiles')
    .select('id, display_name, shift')
    .ilike('display_name', `%${query}%`)
    .limit(5)
  if (error) throw new ToolError('No se pudieron leer los perfiles')
  const matches = (data ?? []) as Target[]
  if (matches.length === 0) {
    throw new ToolError(`Ninguna persona visible para ti coincide con "${query}". Un miembro solo puede consultar sus propias horas.`)
  }
  if (matches.length > 1) {
    throw new ToolError(`Hay ${matches.length} coincidencias (${matches.map((m) => m.display_name).join(', ')}) — precisa el nombre.`)
  }
  return matches[0]
}

async function entriesBetween(db: Db, userId: string, from: string, to: string): Promise<TimeEntry[]> {
  const { data, error } = await db
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date', { ascending: true })
    .order('clock_in', { ascending: true })
  if (error) throw new ToolError('No se pudieron leer las checadas')
  return ((data ?? []) as TimeEntry[]).map(normalizeEntryTimes)
}

function shiftBlock(target: Target, minutes: number) {
  const progress = shiftProgress(minutes, target.shift)
  return {
    jornada: target.shift ? SHIFT_LABELS[target.shift] : null,
    objetivo_semanal_h: target.shift ? SHIFT_HOURS[target.shift].weekly : null,
    cumplimiento_pct: progress?.pct ?? null,
    faltante: progress ? formatDuration(progress.missing) : null,
  }
}

export interface WeekHoursInput {
  persona?: string
  /** Any day of the wanted week (YYYY-MM-DD); default = this week. */
  fecha?: string
}

export async function getWeekHours(db: Db, callerId: string, input: WeekHoursInput = {}) {
  if (input.fecha && !ISO_DATE.test(input.fecha)) throw new ToolError('Fecha inválida — usa YYYY-MM-DD')
  const target = await resolveTarget(db, callerId, input.persona)
  const { start, end } = weekBounds(input.fecha ?? todayInMexico())
  const week = buildWeekView(await entriesBetween(db, target.id, start, end), start)

  return {
    persona: target.display_name,
    semana: { inicio: start, fin: end },
    total: formatDuration(week.minutes),
    total_minutos: week.minutes,
    sin_salida: week.open,
    ...shiftBlock(target, week.minutes),
    dias: week.days.map((d) => ({
      dia: d.label,
      fecha: d.date,
      horas: formatDuration(d.minutes),
      checadas: d.punches.map((p) => ({ entrada: p.entry.clock_in, salida: p.entry.clock_out, nota: p.entry.note })),
      sin_salida: d.open,
    })),
  }
}

export interface HoursTrendInput {
  persona?: string
  /** Weeks to include, ending this week (default 8, max 26). */
  semanas?: number
}

export async function getHoursTrend(db: Db, callerId: string, input: HoursTrendInput = {}) {
  const weeks = Math.min(26, Math.max(1, Math.floor(input.semanas ?? 8)))
  const target = await resolveTarget(db, callerId, input.persona)
  const { start, end } = weekBounds(todayInMexico())
  const from = shiftWeek(start, -(weeks - 1))
  const trend = buildWeeklyTrend(await entriesBetween(db, target.id, from, end), start, weeks)
  const total = trend.reduce((sum, w) => sum + w.minutes, 0)

  return {
    persona: target.display_name,
    semanas: weeks,
    promedio_semanal: formatDuration(total / weeks),
    ...shiftBlock(target, total / weeks),
    por_semana: trend.map((w) => ({
      inicio: w.start,
      fin: w.end,
      horas: formatDuration(w.minutes),
      horas_decimal: w.hours,
      sin_salida: w.open,
    })),
  }
}

export async function listTimeImports(db: Db, input: { limit?: number } = {}) {
  const limit = Math.min(50, Math.max(1, Math.floor(input.limit ?? 10)))
  const { data, error } = await db
    .from('time_imports')
    .select('period_start, period_end, file_name, inserted, updated, skipped_edited, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new ToolError('No se pudo leer la bitácora de cargas')
  const rows = data ?? []
  return {
    // RLS hides every row from a member: say so instead of pretending nothing was ever imported.
    nota: rows.length === 0 ? 'Sin cargas visibles: la bitácora del checador solo la ve un administrador.' : null,
    cargas: rows.map((r) => ({
      periodo: { inicio: r.period_start, fin: r.period_end },
      archivo: r.file_name,
      insertadas: r.inserted,
      actualizadas: r.updated,
      saltadas_por_edicion: r.skipped_edited,
      cargada_el: r.created_at,
    })),
  }
}
