/**
 * Payroll hours (#123, ADR-033): the Saturday→Friday cut and how each day counts.
 * Pure and clock-free; the multiplier is derived from the date, never stored.
 */

import { isRealDate, minutesBetween, SHIFT_HOURS, type ISODate } from '@/lib/timesheet'
import type { PayrollDay, PayrollEmployee, PayrollPeriod, ProfileArea, ProfileShift } from '@/types/database'

const DAY_MS = 86_400_000
const toUtc = (iso: ISODate) => new Date(`${iso}T00:00:00Z`)
const toIso = (d: Date) => d.toISOString().slice(0, 10)

// JS rolls 2026-02-30 into March instead of failing: existence is checked, not just the shape.
export const isIsoDate = isRealDate

/** Friday pays the previous Saturday and Sunday plus this Monday→Friday. */
export function payrollPeriod(date: ISODate): { start: ISODate; end: ISODate } {
  const d = toUtc(date)
  // Saturday → 0 … Friday → 6: same expression as the guard trigger in the database.
  const offset = (d.getUTCDay() + 1) % 7
  const start = new Date(d.getTime() - offset * DAY_MS)
  return { start: toIso(start), end: toIso(new Date(start.getTime() + 6 * DAY_MS)) }
}

export const isPeriodStart = (date: ISODate) => payrollPeriod(date).start === date

export const isSaturday = (date: ISODate) => toUtc(date).getUTCDay() === 6

export function shiftPeriod(start: ISODate, periods: number): ISODate {
  return toIso(new Date(toUtc(start).getTime() + periods * 7 * DAY_MS))
}

export const PERIOD_DAY_LABELS = ['Sáb', 'Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie'] as const

export function periodDates(start: ISODate): ISODate[] {
  return PERIOD_DAY_LABELS.map((_, i) => toIso(new Date(toUtc(start).getTime() + i * DAY_MS)))
}

export const SATURDAY_MULTIPLIER = 2
export const SUNDAY_MULTIPLIER = 3

/** The workshop's Saturday: its first 5 h are ordinary, only what goes past them is ×2 (#135). */
export const WORKSHOP_SATURDAY_REGULAR_MINUTES = 5 * 60

/** The Saturday the office is paid without working it: its shift's daily hours, 8 or 4 (#135). */
export const officeSaturdayMinutes = (shift: ProfileShift) => SHIFT_HOURS[shift].daily * 60

/** Office = linked to a profile whose area is office (Equipo); no account means the workshop (#135). */
export function payrollArea(employee: Pick<PayrollEmployee, 'profile_id'>, areas: ReadonlyMap<string, ProfileArea>): ProfileArea {
  return (employee.profile_id && areas.get(employee.profile_id)) || 'workshop'
}

export interface HoursBreakdown {
  /** Weekday minutes up to the shift's daily hours plus the Saturday's ordinary part (#135). */
  regular: number
  /** Weekday minutes past the shift's daily hours; paid ×1 (decision 2026-09-30). */
  extra: number
  /** Workshop Saturday minutes past the first 5 h; paid ×2 (#135). */
  saturdayExtra: number
  sunday: number
  /** Minutes as paid: regular + extra + saturdayExtra×2 + sunday×3. */
  equivalent: number
}

const EMPTY: HoursBreakdown = { regular: 0, extra: 0, saturdayExtra: 0, sunday: 0, equivalent: 0 }

export function classifyDay(date: ISODate, workedMinutes: number, shift: ProfileShift, area: ProfileArea): HoursBreakdown {
  const worked = Math.max(0, workedMinutes)
  const weekday = toUtc(date).getUTCDay()
  if (isSaturday(date)) {
    // The office's Saturday cell already holds what is paid ("the larger one" is applied when it is prefilled).
    const regular = area === 'office' ? worked : Math.min(worked, WORKSHOP_SATURDAY_REGULAR_MINUTES)
    const extra = worked - regular
    return { ...EMPTY, regular, saturdayExtra: extra, equivalent: regular + extra * SATURDAY_MULTIPLIER }
  }
  if (weekday === 0) return { ...EMPTY, sunday: worked, equivalent: worked * SUNDAY_MULTIPLIER }
  const regular = Math.min(worked, SHIFT_HOURS[shift].daily * 60)
  return { ...EMPTY, regular, extra: worked - regular, equivalent: worked }
}

function add(a: HoursBreakdown, b: HoursBreakdown): HoursBreakdown {
  return {
    regular: a.regular + b.regular,
    extra: a.extra + b.extra,
    saturdayExtra: a.saturdayExtra + b.saturdayExtra,
    sunday: a.sunday + b.sunday,
    equivalent: a.equivalent + b.equivalent,
  }
}

export interface PayrollRow {
  employee: PayrollEmployee
  area: ProfileArea
  /** Saturday→Friday; null = nothing recorded that day. */
  days: (PayrollDay | null)[]
  totals: HoursBreakdown
  missedMinutes: number
  drafts: number
}

export interface PayrollView {
  start: ISODate
  end: ISODate
  dates: ISODate[]
  closed: boolean
  period: PayrollPeriod | null
  rows: PayrollRow[]
  totals: HoursBreakdown
  drafts: number
}

/** Drafts are shown but do NOT count: only confirmed hours reach the totals. */
export function buildPayrollView(
  start: ISODate,
  employees: readonly PayrollEmployee[],
  days: readonly PayrollDay[],
  period: PayrollPeriod | null,
  areas: ReadonlyMap<string, ProfileArea>,
): PayrollView {
  const dates = periodDates(start)
  const byKey = new Map(days.map((d) => [`${d.employee_id}|${d.work_date}`, d]))
  const rows: PayrollRow[] = []
  for (const employee of employees) {
    const cells = dates.map((date) => byKey.get(`${employee.id}|${date}`) ?? null)
    // An inactive employee stays visible only where they have hours.
    if (!employee.active && cells.every((c) => c === null)) continue
    const confirmed = cells.filter((c): c is PayrollDay => c?.status === 'confirmed')
    const area = payrollArea(employee, areas)
    rows.push({
      employee,
      area,
      days: cells,
      totals: confirmed.reduce((sum, c) => add(sum, classifyDay(c.work_date, c.worked_minutes, employee.shift, area)), EMPTY),
      missedMinutes: confirmed.reduce((sum, c) => sum + c.missed_minutes, 0),
      drafts: cells.filter((c) => c?.status === 'draft').length,
    })
  }
  return {
    start,
    end: dates[6],
    dates,
    closed: period?.status === 'closed',
    period,
    rows,
    totals: rows.reduce((sum, r) => add(sum, r.totals), EMPTY),
    drafts: rows.reduce((sum, r) => sum + r.drafts, 0),
  }
}

export const MAX_DAY_MINUTES = 1440

/** Hours as typed ("8", "8.5", "8:30") → minutes; null when it is not a day's worth of time. */
export function parseHoursInput(raw: string): number | null {
  const value = raw.trim().replace(',', '.')
  if (value === '') return 0
  let minutes: number
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(value)
  if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2])
  else if (/^\d+(\.\d+)?$/.test(value)) minutes = Math.round(Number(value) * 60)
  else return null
  return minutes <= MAX_DAY_MINUTES ? minutes : null
}

export const isDayMinutes = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_DAY_MINUTES

interface PunchLike {
  work_date: ISODate
  clock_in: string
  clock_out: string | null
}

/** Minutes per date from the clock's punches; a punch without clock-out adds nothing and is counted apart. */
export function minutesByDate(entries: readonly PunchLike[]): Map<ISODate, { minutes: number; open: number }> {
  const out = new Map<ISODate, { minutes: number; open: number }>()
  for (const e of entries) {
    const day = out.get(e.work_date) ?? { minutes: 0, open: 0 }
    const minutes = minutesBetween(e.clock_in, e.clock_out)
    if (minutes == null) day.open += 1
    else day.minutes += minutes
    out.set(e.work_date, day)
  }
  return out
}

// ─── Employees ───

export const EMPLOYEE_NAME_MAX = 80
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type EmployeeInput = Partial<Pick<PayrollEmployee, 'name' | 'profile_id' | 'shift' | 'active'>>

/** Validates what the form sends; only the keys present are returned (PATCH-friendly). */
export function parseEmployeeInput(
  body: unknown,
  opts: { requireName: boolean },
): { value: EmployeeInput } | { error: string } {
  const raw = (body ?? {}) as Record<string, unknown>
  const value: EmployeeInput = {}
  if (raw.name !== undefined || opts.requireName) {
    const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : ''
    if (!name) return { error: 'El nombre es obligatorio' }
    if (name.length > EMPLOYEE_NAME_MAX) return { error: `El nombre no puede pasar de ${EMPLOYEE_NAME_MAX} caracteres` }
    value.name = name
  }
  if (raw.profile_id !== undefined) {
    if (raw.profile_id !== null && (typeof raw.profile_id !== 'string' || !UUID_RE.test(raw.profile_id))) {
      return { error: 'Perfil inválido' }
    }
    value.profile_id = raw.profile_id as string | null
  }
  if (raw.shift !== undefined) {
    if (raw.shift !== 'full_time' && raw.shift !== 'part_time') return { error: 'Jornada inválida' }
    value.shift = raw.shift
  }
  if (raw.active !== undefined) {
    if (typeof raw.active !== 'boolean') return { error: 'Estado inválido' }
    value.active = raw.active
  }
  return { value }
}

/** Two UNIQUEs on the table: the constraint name in the message says which one tripped. */
export function payrollDuplicateMessage(pgMessage: string): string {
  return pgMessage.includes('profile_id')
    ? 'Ese perfil ya está ligado a otro empleado'
    : 'Ya existe un empleado con ese nombre'
}
