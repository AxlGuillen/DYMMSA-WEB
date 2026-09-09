/**
 * Clock report math (#93): NGTeco weekly export parser + duration/week helpers.
 * Pure. Callers normalize supabase-js `time` strings before calling.
 */

export type ISODate = string
export type HHMM = string

export interface ParsedPunch {
  date: ISODate
  clockIn: HHMM
  clockOut: HHMM | null
  note: string | null
}

export interface ParsedEmployee {
  /** Clock id from "Nombre (id)"; null when the header could not be parsed. */
  clockId: number | null
  name: string
  punches: ParsedPunch[]
  /** "Horas totales" as printed by the clock; informative only, we recompute. */
  reportedTotal: string | null
}

export interface ParsedReport {
  period: { start: ISODate; end: ISODate } | null
  employees: ParsedEmployee[]
  warnings: string[]
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
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
      report.warnings.push(`Salida sin entrada: ${current.name} ${lastDate} ${clockOut}`)
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
    })
  }

  for (const e of report.employees) {
    e.punches.sort((a, b) => (a.date + a.clockIn).localeCompare(b.date + b.clockIn))
  }
  return report
}

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
