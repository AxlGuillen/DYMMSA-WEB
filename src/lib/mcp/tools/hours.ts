/**
 * Hours module, read-only (#101, ADR-029). No permission logic here on purpose: the db comes
 * from the caller's token, so RLS decides — a member sees only their own rows and profile.
 */

import { ToolError, type Db } from '../shared'
import { resolvePerson } from './profiles'
import { todayInMexico } from '@/lib/format'
import {
  buildWeekView,
  buildWeeklyTrend,
  EXCUSE_LABELS,
  excusesFor,
  weekChartData,
  weekTargetMinutes,
  type DayStatus,
  formatDuration,
  normalizeEntryTimes,
  shiftProgress,
  SHIFT_HOURS,
  SHIFT_LABELS,
  weekBounds,
  shiftWeek,
} from '@/lib/timesheet'
import type { ExcusedDay, Profile, TimeEntry } from '@/types/database'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

type Target = Pick<Profile, 'id' | 'display_name' | 'shift'>

const resolveTarget = (db: Db, callerId: string, persona?: string) =>
  resolvePerson<Target>(db, callerId, persona, 'id, display_name, shift')

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

type ExcusedRow = Pick<ExcusedDay, 'work_date' | 'user_id' | 'kind' | 'note'>

async function excusedBetween(db: Db, userId: string, from: string, to: string): Promise<ExcusedRow[]> {
  const { data, error } = await db
    .from('excused_days')
    .select('work_date, user_id, kind, note')
    .gte('work_date', from)
    .lte('work_date', to)
    .or(`user_id.is.null,user_id.eq.${userId}`)
  if (error) throw new ToolError('No se pudieron leer los días justificados')
  return (data ?? []) as ExcusedRow[]
}

const DAY_STATUS_LABELS: Record<DayStatus, string | null> = {
  met: 'cumplió',
  short: 'no cumplió',
  excused: 'justificado',
  open: 'checada sin salida',
  pending: 'en curso',
  off: null,
}

function shiftBlock(target: Target) {
  return {
    jornada: target.shift ? SHIFT_LABELS[target.shift] : null,
    objetivo_semanal_h: target.shift ? SHIFT_HOURS[target.shift].weekly : null,
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
  const [entries, excused] = await Promise.all([
    entriesBetween(db, target.id, start, end),
    excusedBetween(db, target.id, start, end),
  ])
  const week = buildWeekView(entries, start)
  const excuses = excusesFor(excused, target.id)
  const weekTarget = weekTargetMinutes(week, target.shift, excuses)
  const progress = shiftProgress(week.minutes, target.shift, weekTarget)
  const points = weekChartData(week, target.shift, excuses, todayInMexico())

  return {
    persona: target.display_name,
    semana: { inicio: start, fin: end },
    total: formatDuration(week.minutes),
    total_minutos: week.minutes,
    sin_salida: week.open,
    ...shiftBlock(target),
    // Discounts holidays and authorized early exits; null without a shift.
    objetivo_de_esta_semana: weekTarget === null ? null : formatDuration(weekTarget),
    cumplimiento_pct: progress?.pct ?? null,
    faltante: progress ? formatDuration(progress.missing) : null,
    dias: week.days.map((d, i) => ({
      dia: d.label,
      fecha: d.date,
      horas: formatDuration(d.minutes),
      estado: DAY_STATUS_LABELS[points[i].status],
      justificado: points[i].excuse ? EXCUSE_LABELS[points[i].excuse] : null,
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
  const [entries, excused] = await Promise.all([
    entriesBetween(db, target.id, from, end),
    excusedBetween(db, target.id, from, end),
  ])
  const trend = buildWeeklyTrend(entries, start, weeks, { shift: target.shift, excuses: excusesFor(excused, target.id) })
  const total = trend.reduce((sum, w) => sum + w.minutes, 0)
  // Against the discounted targets, like the week view: a holiday week is not a short week (review PR #128).
  const targetTotal = target.shift ? trend.reduce((sum, w) => sum + (w.target ?? 0), 0) : null
  const progress = shiftProgress(total / weeks, target.shift, targetTotal === null ? null : targetTotal / weeks)

  return {
    persona: target.display_name,
    semanas: weeks,
    promedio_semanal: formatDuration(total / weeks),
    ...shiftBlock(target),
    // Over the AVERAGE week, not this week: named so the model does not phrase it as "this week".
    cumplimiento_promedio_pct: progress?.pct ?? null,
    faltante_promedio: progress ? formatDuration(progress.missing) : null,
    // Empty weeks count as 0 in the average: someone new would read as falling short (review PR #125).
    semanas_con_registro: trend.filter((w) => w.minutes > 0 || w.open > 0).length,
    por_semana: trend.map((w) => ({
      inicio: w.start,
      fin: w.end,
      horas: formatDuration(w.minutes),
      horas_decimal: w.hours,
      objetivo: w.target === null ? null : formatDuration(w.target),
      dias_justificados: w.excused,
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
