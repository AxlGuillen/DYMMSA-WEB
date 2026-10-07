/**
 * Hours module (#101, ADR-029) plus the clock report write (#132). No permission logic here on
 * purpose: the db comes from the caller's token, so RLS decides — a member sees only their own rows.
 */

import { ToolError, type Db } from '../shared'
import { resolvePerson } from './profiles'
import { todayInMexico } from '@/lib/format'
import { correctTimeEntry, createManualEntry, importTimeReport, TimeEntryError } from '@/lib/time-entries-store'
import {
  buildWeekView,
  buildWeeklyTrend,
  EXCUSE_LABELS,
  excusesFor,
  isRealDate,
  weekChartData,
  weekTargetMinutes,
  type DayStatus,
  formatDuration,
  minutesBetween,
  normalizeEntryTimes,
  normalizeTime,
  parseExcusedDay,
  parseNgtecoReport,
  reportMismatches,
  shiftProgress,
  SHIFT_HOURS,
  SHIFT_LABELS,
  weekBounds,
  shiftWeek,
} from '@/lib/timesheet'
import type { ExcusedDay, Profile, TimeEntry, TimeEntryUpdate } from '@/types/database'

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
  // JS rolls 2026-02-30 into March: the tool would answer another week as if it were the one asked.
  if (input.fecha && !isRealDate(input.fecha)) throw new ToolError('Fecha inválida — usa YYYY-MM-DD')
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

export interface PunchInput {
  persona?: string
  fecha: string
  /** The punch's clock-in as it is now; omitted = a new manual punch. */
  entrada_actual?: string
  entrada?: string
  /** '' clears it. */
  salida?: string
  nota?: string
}

export interface SaveTimeEntriesInput {
  /** The clock report's rows, cell by cell, as the sheet prints them. */
  filas?: string[][]
  nombre_archivo?: string
  checada?: PunchInput
}

const ASSISTANT_FILE = 'Asistente (MCP)'

/** One tool per entity (ADR-034): the weekly report (#132) or a single punch (#134). */
export async function saveTimeEntries(db: Db, callerId: string, input: SaveTimeEntriesInput) {
  if (input.filas?.length && input.checada) throw new ToolError('Manda `filas` o `checada`, no las dos en la misma llamada')
  if (input.checada) return savePunch(db, callerId, input.checada)
  return importReport(db, input)
}

/** The rows go through the app's own parser, and must add up to the clock's totals (ADR-035). */
async function importReport(db: Db, input: SaveTimeEntriesInput) {
  if (!input.filas?.length) throw new ToolError('Manda las filas del reporte del checador, o una `checada` para corregir o registrar')
  const report = parseNgtecoReport(input.filas)
  const mismatches = reportMismatches(report)
  if (mismatches.length > 0) {
    throw new ToolError(
      `No guardé nada: lo que mandaste no cuadra con los totales del propio reporte. Revisa esas filas contra el archivo y vuelve a mandarlo completo. ${mismatches.join(' · ')}`,
    )
  }
  const name = input.nombre_archivo?.trim()
  const { result, absent } = await asTool(() =>
    importTimeReport(db, report, name ? `${ASSISTANT_FILE}: ${name.slice(0, 120)}` : ASSISTANT_FILE),
  )
  return {
    periodo: { inicio: result.period.start, fin: result.period.end },
    insertadas: result.inserted,
    actualizadas: result.updated,
    saltadas_por_edicion: result.skipped_edited,
    personas: report.employees.map((e) => ({
      nombre: e.name,
      id_checador: e.clockId,
      checadas: e.punches.length,
      sin_salida: e.punches.filter((p) => !p.clockOut).length,
    })),
    sin_perfil: result.unmapped.map((u) => `${u.name} (${u.clockId})`),
    no_vinieron_en_el_reporte: absent,
    avisos: result.warnings,
    nota: 'Re-subir la misma semana no duplica y nunca pisa una checada corregida por un administrador (sale en saltadas_por_edicion).',
  }
}

/** Same rules as the app's dialog: corrections keep the clock's original and survive the re-import. */
async function savePunch(db: Db, callerId: string, input: PunchInput) {
  if (!isRealDate(input.fecha)) throw new ToolError('Fecha inválida — usa YYYY-MM-DD')
  const person = await resolvePerson<Pick<Profile, 'id' | 'display_name'>>(db, callerId, input.persona, 'id, display_name')
  let entry: TimeEntry
  let corrected = false
  if (input.entrada_actual === undefined) {
    if (input.entrada === undefined) throw new ToolError('Para registrar una checada nueva manda `entrada`; para corregir una, `entrada_actual`')
    entry = await asTool(() =>
      createManualEntry(db, { user_id: person.id, work_date: input.fecha, clock_in: input.entrada, clock_out: input.salida, note: input.nota }),
    )
  } else {
    const day = await entriesBetween(db, person.id, input.fecha, input.fecha)
    const wanted = normalizeTime(input.entrada_actual)
    const target = day.find((e) => e.clock_in === wanted)
    if (!target) {
      const seen = day.map((e) => `${e.clock_in}–${e.clock_out ?? 'sin salida'}`).join(', ') || 'ninguna'
      throw new ToolError(`${person.display_name} no tiene una checada con entrada ${input.entrada_actual} el ${input.fecha}. Checadas de ese día: ${seen}`)
    }
    const update: TimeEntryUpdate = {}
    if (input.entrada !== undefined) update.clock_in = input.entrada
    if (input.salida !== undefined) update.clock_out = input.salida
    if (input.nota !== undefined) update.note = input.nota
    entry = await asTool(() => correctTimeEntry(db, target.id, update, callerId))
    corrected = true
  }
  const minutes = minutesBetween(entry.clock_in, entry.clock_out)
  return {
    accion: corrected ? 'corregida' : 'registrada a mano',
    persona: person.display_name,
    fecha: entry.work_date,
    entrada: entry.clock_in,
    salida: entry.clock_out,
    horas: minutes === null ? null : formatDuration(minutes),
    nota: entry.note,
    lo_que_dijo_el_checador: entry.original ? { entrada: entry.original.clock_in, salida: entry.original.clock_out } : null,
  }
}

async function asTool<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof TimeEntryError) throw new ToolError(error.message)
    throw error
  }
}

const KIND_BY_INPUT = { feriado: 'holiday', salida_autorizada: 'early_release' } as const

export interface SaveExcusedDayInput {
  fecha: string
  tipo?: keyof typeof KIND_BY_INPUT
  /** Omitted = the whole team. */
  persona?: string
  nota?: string
  quitar?: boolean
}

/** Marks, changes or removes a holiday / authorized early exit (#134); same parser as the route. */
export async function saveExcusedDay(db: Db, callerId: string, input: SaveExcusedDayInput) {
  const person = input.persona?.trim()
    ? await resolvePerson<Pick<Profile, 'id' | 'display_name'>>(db, callerId, input.persona, 'id, display_name')
    : null
  const who = person?.display_name ?? 'todo el equipo'
  if (!isRealDate(input.fecha)) throw new ToolError('Fecha inválida — usa YYYY-MM-DD')

  let existing = db.from('excused_days').select('id, kind, note').eq('work_date', input.fecha)
  existing = person ? existing.eq('user_id', person.id) : existing.is('user_id', null)
  const { data: found, error: findError } = await existing.maybeSingle()
  if (findError) throw new ToolError('No se pudieron leer los días justificados')
  const current = found as Pick<ExcusedDay, 'id' | 'kind' | 'note'> | null

  if (input.quitar) {
    if (!current) throw new ToolError(`El ${input.fecha} no está justificado para ${who}`)
    const { error } = await db.from('excused_days').delete().eq('id', current.id)
    if (error) throw new ToolError('No se pudo quitar el día justificado')
    return { accion: 'quitado', fecha: input.fecha, para: who, era: EXCUSE_LABELS[current.kind] }
  }

  const kind = input.tipo ? KIND_BY_INPUT[input.tipo] : current?.kind
  const parsed = parseExcusedDay({ work_date: input.fecha, kind, user_id: person?.id ?? null, note: input.nota ?? current?.note ?? '' })
  if ('error' in parsed) throw new ToolError(parsed.error)
  const { error } = current
    ? await db.from('excused_days').update({ kind: parsed.value.kind, note: parsed.value.note }).eq('id', current.id)
    : await db.from('excused_days').insert(parsed.value)
  if (error) {
    if (error.code === '42501') throw new ToolError('Solo un administrador puede justificar días')
    throw new ToolError('No se pudo guardar el día justificado')
  }
  return {
    accion: current ? 'actualizado' : 'marcado',
    fecha: input.fecha,
    tipo: EXCUSE_LABELS[parsed.value.kind],
    para: who,
    nota: parsed.value.note,
    efecto:
      parsed.value.kind === 'holiday'
        ? 'Ese día no pide horas: se descuenta del objetivo de la semana.'
        : 'Ese día cuenta como cumplido con lo que se trabajó.',
  }
}
