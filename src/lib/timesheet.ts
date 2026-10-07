/**
 * Clock report math (#93): NGTeco weekly export parser + duration/week helpers.
 * Pure. Callers normalize supabase-js `time` strings before calling.
 */

import type { ExcusedDay, ExcusedDayInsert, ExcuseKind, ProfileShift } from '@/types/database'

export type ISODate = string
export type HHMM = string

export interface ParsedPunch {
  date: ISODate
  clockIn: HHMM
  clockOut: HHMM | null
  note: string | null
  /** "Tiempo de trabajo" as printed; the clock counts seconds, so it may be a minute off ours. */
  reported: HHMM | null
}

export interface ParsedEmployee {
  /** Clock id from "Nombre (id)"; null when the header could not be parsed. */
  clockId: number | null
  name: string
  punches: ParsedPunch[]
  /** "Horas totales" as printed by the clock; we recompute, the MCP checks it (reportMismatches). */
  reportedTotal: string | null
}

export interface ParsedReport {
  period: { start: ISODate; end: ISODate } | null
  employees: ParsedEmployee[]
  warnings: string[]
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Shape AND existence: 2026-02-30 matches the regex and Postgres answers 22008 → a 500 (review PR #128). */
export function isRealDate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
const PERIOD = /(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/
// [\s\S] instead of the `s` flag: the project targets below es2018.
const EMPLOYEE = /^([\s\S]*?)\s*\((\d+)\)\s*$/
const TIME = /^(\d{1,2}):(\d{1,2})(?::\d{2})?$/
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Excel may type cells: a day fraction is a time, a serial is a date. */
export function cellText(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    if (value >= 0 && value < 1) {
      const minutes = Math.round(value * 1440)
      return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`
    }
    return new Date(EXCEL_EPOCH_MS + Math.round(value) * 86_400_000).toISOString().slice(0, 10)
  }
  return String(value).trim()
}

/** 'HH:MM' | 'H:M' | 'HH:MM:SS' → 'HH:MM'; anything else → null. */
export function normalizeTime(value: string): HHMM | null {
  const m = value.trim().match(TIME)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${pad2(h)}:${pad2(min)}`
}

type TimedRow = { clock_in: string; clock_out: string | null; source_clock_in: string }

/** PostgREST serializes `time` as HH:MM:SS; the lib and the UI work in HH:MM. */
export function normalizeEntryTimes<T extends TimedRow>(row: T): T {
  return {
    ...row,
    clock_in: normalizeTime(row.clock_in) ?? row.clock_in,
    clock_out: row.clock_out ? (normalizeTime(row.clock_out) ?? row.clock_out) : null,
    source_clock_in: normalizeTime(row.source_clock_in) ?? row.source_clock_in,
  }
}

export function parseNgtecoReport(rows: unknown[][]): ParsedReport {
  const report: ParsedReport = { period: null, employees: [], warnings: [] }
  let current: ParsedEmployee | null = null
  let lastDate: ISODate | null = null

  for (const raw of rows) {
    const cells = (raw ?? []).map(cellText)
    const first = cells[0] ?? ''
    if (cells.every((c) => c === '')) continue

    if (/^per[ií]odo de pago/i.test(first)) {
      const match = cells.map((c) => c.match(PERIOD)).find(Boolean)
      if (match) report.period = { start: match[1], end: match[2] }
      else report.warnings.push('Período de pago sin fechas reconocibles')
      continue
    }

    if (/^empleado/i.test(first)) {
      const label = cells.slice(1).find((c) => c !== '') ?? ''
      const m = label.match(EMPLOYEE)
      current = {
        clockId: m ? Number(m[2]) : null,
        name: (m ? m[1] : label).replace(/\s+/g, ' ').trim(),
        punches: [],
        reportedTotal: null,
      }
      if (!m) report.warnings.push(`Empleado sin id de checador: "${current.name}"`)
      report.employees.push(current)
      lastDate = null
      continue
    }

    if (/^fecha$/i.test(first)) continue

    if (/^horas totales/i.test(first)) {
      if (current) current.reportedTotal = cells.slice(1).find((c) => TIME.test(c)) ?? null
      current = null
      lastDate = null
      continue
    }

    // Day row: col 1 carries the date; a continuation row leaves it blank.
    const date = ISO_DATE.test(cells[1] ?? '') ? cells[1] : null
    if (date) lastDate = date
    const clockIn = cells[2] ?? ''
    const clockOut = cells[3] ?? ''
    if (clockIn === '' && clockOut === '') continue

    if (!current) {
      report.warnings.push(`Checada fuera de un bloque de empleado (${lastDate ?? 'sin fecha'})`)
      continue
    }
    if (!lastDate) {
      report.warnings.push(`Checada sin fecha para ${current.name}`)
      continue
    }
    const inTime = normalizeTime(clockIn)
    if (!inTime) {
      report.warnings.push(
        clockIn === ''
          ? `Salida sin entrada: ${current.name} ${lastDate} ${clockOut}`
          : `Hora de entrada inválida: ${current.name} ${lastDate} "${clockIn}"`,
      )
      continue
    }
    const outTime = clockOut === '' ? null : normalizeTime(clockOut)
    if (clockOut !== '' && !outTime) {
      report.warnings.push(`Hora de salida inválida: ${current.name} ${lastDate} "${clockOut}"`)
    }
    if (report.period && (lastDate < report.period.start || lastDate > report.period.end)) {
      report.warnings.push(`Fecha fuera del período: ${current.name} ${lastDate}`)
    }
    current.punches.push({
      date: lastDate,
      clockIn: inTime,
      clockOut: outTime,
      note: (cells[6] ?? '') === '' ? null : cells[6],
      reported: normalizeTime(cells[4] ?? ''),
    })
  }

  for (const e of report.employees) {
    e.punches.sort((a, b) => (a.date + a.clockIn).localeCompare(b.date + b.clockIn))
  }
  return report
}

/**
 * Rows transcribed by the assistant must add up to the clock's own figures (#132, ADR-035):
 * a pair may be a minute off (seconds), a block one minute per pair.
 */
export function employeeMismatches(employee: ParsedEmployee): string[] {
  const problems: string[] = []
  let total = 0
  let pairs = 0
  for (const p of employee.punches) {
    const minutes = minutesBetween(p.clockIn, p.clockOut)
    if (minutes === null) continue
    total += minutes
    pairs++
    if (p.reported && Math.abs(minutes - toMinutes(p.reported)) > 1) {
      problems.push(`${employee.name} ${p.date} ${p.clockIn}–${p.clockOut}: el reporte dice ${p.reported} de trabajo`)
    }
  }
  if (employee.reportedTotal === null) {
    if (pairs > 0) problems.push(`${employee.name}: falta su fila "Horas totales"`)
  } else if (Math.abs(total - toMinutes(employee.reportedTotal)) > Math.max(1, pairs)) {
    problems.push(`${employee.name}: las checadas suman ${formatDuration(total)} y el reporte dice ${employee.reportedTotal}`)
  }
  return problems
}

export const reportMismatches = (report: ParsedReport): string[] => report.employees.flatMap(employeeMismatches)

// ─── Durations ───

export function toMinutes(time: HHMM): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Same-day pairs only; a clock-out before the clock-in counts as 0. */
export function minutesBetween(clockIn: HHMM, clockOut: HHMM | null): number | null {
  if (clockOut == null) return null
  return Math.max(0, toMinutes(clockOut) - toMinutes(clockIn))
}

/** Accumulates as a duration, so totals past 24 h read "37:54", not as a clock time. */
export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`
}

// ─── Weeks ───

const DAY_MS = 86_400_000
const toUtc = (iso: ISODate) => new Date(`${iso}T00:00:00Z`)
const toIso = (d: Date) => d.toISOString().slice(0, 10)

/** Monday→Sunday week containing `date`, matching the clock's "Período de pago". */
export function weekBounds(date: ISODate): { start: ISODate; end: ISODate } {
  const d = toUtc(date)
  const offset = (d.getUTCDay() + 6) % 7
  const start = new Date(d.getTime() - offset * DAY_MS)
  return { start: toIso(start), end: toIso(new Date(start.getTime() + 6 * DAY_MS)) }
}

export function shiftWeek(weekStart: ISODate, weeks: number): ISODate {
  return toIso(new Date(toUtc(weekStart).getTime() + weeks * 7 * DAY_MS))
}

export const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

export interface WeekPunch<T> {
  entry: T
  /** null while the clock-out is missing. */
  minutes: number | null
}

export interface WeekDay<T> {
  date: ISODate
  label: (typeof WEEKDAY_LABELS)[number]
  punches: WeekPunch<T>[]
  minutes: number
  /** Pairs without a clock-out. */
  open: number
}

export interface WeekView<T> {
  start: ISODate
  end: ISODate
  days: WeekDay<T>[]
  minutes: number
  open: number
}

type EntryLike = { work_date: string; clock_in: string; clock_out: string | null }

/** Seven days, empty ones included (presentation); totals derived, never stored. */
export function buildWeekView<T extends EntryLike>(entries: readonly T[], weekStart: ISODate): WeekView<T> {
  const start = toUtc(weekStart)
  const days: WeekDay<T>[] = WEEKDAY_LABELS.map((label, i) => ({
    date: toIso(new Date(start.getTime() + i * DAY_MS)),
    label,
    punches: [],
    minutes: 0,
    open: 0,
  }))
  const byDate = new Map(days.map((d) => [d.date, d]))

  for (const entry of [...entries].sort((a, b) => (a.work_date + a.clock_in).localeCompare(b.work_date + b.clock_in))) {
    const day = byDate.get(entry.work_date)
    if (!day) continue
    const minutes = minutesBetween(entry.clock_in, entry.clock_out)
    day.punches.push({ entry, minutes })
    if (minutes == null) day.open += 1
    else day.minutes += minutes
  }

  return {
    start: weekStart,
    end: days[6].date,
    days,
    minutes: days.reduce((sum, d) => sum + d.minutes, 0),
    open: days.reduce((sum, d) => sum + d.open, 0),
  }
}

// ─── Shift references (#101) ───

/** Daily and weekly targets per shift: 5-day week, decision 2026-09-24. */
export const SHIFT_HOURS: Record<ProfileShift, { daily: number; weekly: number }> = {
  full_time: { daily: 8, weekly: 40 },
  part_time: { daily: 4, weekly: 20 },
}

export const SHIFT_LABELS: Record<ProfileShift, string> = {
  full_time: 'Tiempo completo · 8 h',
  part_time: 'Medio tiempo · 4 h',
}

export const SHIFTS: readonly ProfileShift[] = ['full_time', 'part_time']

const toHours = (minutes: number) => Math.round((minutes / 60) * 10) / 10

// ─── Daily compliance and excused days (meeting 2026-10-01) ───

export const EXCUSE_LABELS: Record<ExcuseKind, string> = {
  holiday: 'Día feriado',
  early_release: 'Salida autorizada',
}

const EXCUSE_KINDS: readonly ExcuseKind[] = ['holiday', 'early_release']

/** Body of a new excused day; the user id is checked as a uuid by the route. */
export function parseExcusedDay(body: unknown): { value: ExcusedDayInsert } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  if (!isRealDate(b.work_date)) return { error: 'Fecha inválida' }
  if (!EXCUSE_KINDS.includes(b.kind as ExcuseKind)) return { error: 'Tipo inválido: día feriado o salida autorizada' }
  if (b.user_id !== undefined && b.user_id !== null && typeof b.user_id !== 'string') return { error: 'Persona inválida' }
  const note = typeof b.note === 'string' ? b.note.trim() : ''
  if (note.length > 200) return { error: 'La nota no puede pasar de 200 caracteres' }
  return { value: { work_date: b.work_date, kind: b.kind as ExcuseKind, user_id: (b.user_id as string | null | undefined) || null, note: note || null } }
}

/** One excuse per date for a person: their own beats the team-wide one. */
export function excusesFor(excused: readonly Pick<ExcusedDay, 'work_date' | 'user_id' | 'kind'>[], userId: string): Map<ISODate, ExcuseKind> {
  const out = new Map<ISODate, ExcuseKind>()
  for (const e of excused) if (e.user_id === null) out.set(e.work_date, e.kind)
  for (const e of excused) if (e.user_id === userId) out.set(e.work_date, e.kind)
  return out
}

const WORKDAYS = 5

/** Minutes a weekday asks for: a holiday asks nothing, an authorized early exit asks what was worked. */
export function dayTargetMinutes(index: number, minutes: number, shift: ProfileShift, excuse: ExcuseKind | undefined): number {
  if (index >= WORKDAYS) return 0
  const daily = SHIFT_HOURS[shift].daily * 60
  if (excuse === 'holiday') return 0
  if (excuse === 'early_release') return Math.min(daily, minutes)
  return daily
}

/** Excused days that actually discount something: a marked Saturday never asked for hours. */
export function excusedWeekdays(week: WeekView<unknown>, excuses: ReadonlyMap<ISODate, ExcuseKind>): number {
  return week.days.filter((d, i) => i < WORKDAYS && excuses.has(d.date)).length
}

/** The week's target once excused days are discounted; null without an assigned shift. */
export function weekTargetMinutes(week: WeekView<unknown>, shift: ProfileShift | null | undefined, excuses: ReadonlyMap<ISODate, ExcuseKind>): number | null {
  if (!shift) return null
  return week.days.reduce((sum, d, i) => sum + dayTargetMinutes(i, d.minutes, shift, excuses.get(d.date)), 0)
}

/** met/short paint green/red; open = clock-out missing; pending = today or later; off = weekend or no shift. */
export type DayStatus = 'met' | 'short' | 'excused' | 'open' | 'pending' | 'off'

export function dayStatus(
  index: number,
  day: Pick<WeekDay<unknown>, 'date' | 'minutes' | 'open'>,
  shift: ProfileShift | null | undefined,
  excuse: ExcuseKind | undefined,
  today: ISODate,
): DayStatus {
  if (!shift || index >= WORKDAYS) return 'off'
  if (excuse) return 'excused'
  if (day.open > 0) return 'open'
  if (day.date > today) return 'pending'
  if (day.minutes >= SHIFT_HOURS[shift].daily * 60) return 'met'
  // Today is still running: it only turns red tomorrow.
  return day.date === today ? 'pending' : 'short'
}

export interface WeekChartPoint {
  label: (typeof WEEKDAY_LABELS)[number]
  date: ISODate
  hours: number
  /** Exact, for the tooltip: `hours` is rounded to 0.1 for the bar. */
  minutes: number
  /** Pairs without a clock-out: they add nothing, so the bar must not read as a short day. */
  open: number
  status: DayStatus
  excuse: ExcuseKind | null
  /** Minutes short of the daily shift; 0 unless `short`. */
  missing: number
}

/** The week as the chart draws it; every number is prepared here, never in the component. */
export function weekChartData(
  week: WeekView<unknown>,
  shift: ProfileShift | null | undefined = null,
  excuses: ReadonlyMap<ISODate, ExcuseKind> = new Map(),
  today: ISODate = '9999-12-31',
): WeekChartPoint[] {
  return week.days.map((d, i) => {
    const excuse = excuses.get(d.date) ?? null
    const status = dayStatus(i, d, shift, excuse ?? undefined, today)
    const missing = status === 'short' && shift ? SHIFT_HOURS[shift].daily * 60 - d.minutes : 0
    return { label: d.label, date: d.date, hours: toHours(d.minutes), minutes: d.minutes, open: d.open, status, excuse, missing }
  })
}

export interface ShiftProgress {
  /** Weekly target in minutes. */
  target: number
  /** 0–100+, rounded. */
  pct: number
  /** Minutes short of the target; 0 when met. */
  missing: number
}

/** Weekly total against the shift target (or `targetMinutes` once excused days are discounted); null without a shift. */
export function shiftProgress(minutes: number, shift: ProfileShift | null | undefined, targetMinutes?: number | null): ShiftProgress | null {
  if (!shift) return null
  const target = targetMinutes ?? SHIFT_HOURS[shift].weekly * 60
  if (target === 0) return { target, pct: 100, missing: 0 }
  return { target, pct: Math.round((minutes / target) * 100), missing: Math.max(0, target - minutes) }
}

export interface WeekTrendPoint {
  start: ISODate
  end: ISODate
  hours: number
  minutes: number
  open: number
  /** The week's target once excused days are discounted; null without a shift. */
  target: number | null
  /** Excused weekdays of that week. */
  excused: number
}

export interface TrendOptions {
  shift?: ProfileShift | null
  excuses?: ReadonlyMap<ISODate, ExcuseKind>
}

/** The `weeks` weeks ending at `lastWeekStart`, oldest first; an empty week is 0, never missing. */
export function buildWeeklyTrend<T extends EntryLike>(
  entries: readonly T[],
  lastWeekStart: ISODate,
  weeks = 8,
  { shift = null, excuses = new Map() }: TrendOptions = {},
): WeekTrendPoint[] {
  const out: WeekTrendPoint[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const week = buildWeekView(entries, shiftWeek(lastWeekStart, -i))
    out.push({
      start: week.start,
      end: week.end,
      hours: toHours(week.minutes),
      minutes: week.minutes,
      open: week.open,
      target: weekTargetMinutes(week, shift, excuses),
      excused: excusedWeekdays(week, excuses),
    })
  }
  return out
}
