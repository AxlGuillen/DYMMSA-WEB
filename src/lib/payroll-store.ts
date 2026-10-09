/**
 * Payroll reads and writes shared by the API routes and the MCP tools (#123, ADR-033).
 * The client comes from the caller, so RLS (`is_admin()`) is the gate — zero service_role.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeEntryTimes, type ISODate } from '@/lib/timesheet'
import {
  buildPayrollView,
  isDayMinutes,
  isIsoDate,
  isPeriodStart,
  minutesByDate,
  officeSaturdayMinutes,
  payrollArea,
  payrollDuplicateMessage,
  payrollPeriod,
  periodDates,
  type EmployeeInput,
  type PayrollView,
} from '@/lib/payroll'
import { formatDuration } from '@/lib/timesheet'
import type {
  PayrollDay,
  PayrollDaySource,
  PayrollDayStatus,
  PayrollEmployee,
  PayrollPeriod,
  ProfileArea,
  TimeEntry,
} from '@/types/database'

/** A rule the user broke (→ 400 / ToolError); anything else is a real failure. */
export class PayrollError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayrollError'
  }
}

const NOTE_MAX = 300

export async function loadEmployees(db: SupabaseClient): Promise<PayrollEmployee[]> {
  const { data, error } = await db.from('payroll_employees').select('*').order('name', { ascending: true })
  if (error) throw new Error(`payroll_employees: ${error.message}`)
  return (data ?? []) as PayrollEmployee[]
}

/** The constraint errors an employee write can hit, in the user's words; null = a real failure. */
function employeeWriteError(error: { code?: string; message: string }): PayrollError | null {
  if (error.code === '23505') return new PayrollError(payrollDuplicateMessage(error.message))
  if (error.code === '23503') return new PayrollError('El perfil ligado no existe')
  if (error.code === '42501') return new PayrollError('Solo un administrador puede dar de alta o cambiar empleados de nómina')
  return null
}

/** Shared by POST /api/payroll/employees and save_payroll_employee (#134); `value` comes from parseEmployeeInput. */
export async function createEmployee(db: SupabaseClient, value: EmployeeInput): Promise<PayrollEmployee> {
  const { data, error } = await db.from('payroll_employees').insert(value).select('*').single()
  if (error || !data) throw (error && employeeWriteError(error)) ?? new Error(`payroll_employees insert: ${error?.message}`)
  return data as PayrollEmployee
}

/** null = no such employee (or, for a member, none visible: RLS filters the update to 0 rows). */
export async function updateEmployee(db: SupabaseClient, id: string, value: EmployeeInput): Promise<PayrollEmployee | null> {
  const { data, error } = await db.from('payroll_employees').update(value).eq('id', id).select('*').maybeSingle()
  if (error) throw employeeWriteError(error) ?? new Error(`payroll_employees update: ${error.message}`)
  return (data as PayrollEmployee | null) ?? null
}

/** Area of each linked profile: office or workshop decides how the Saturday counts (#135). */
async function loadProfileAreas(db: SupabaseClient, ids?: readonly string[]): Promise<Map<string, ProfileArea>> {
  let query = db.from('profiles').select('id, area')
  if (ids) query = query.in('id', ids)
  const { data, error } = await query
  if (error) throw new Error(`profiles: ${error.message}`)
  return new Map(((data ?? []) as { id: string; area: ProfileArea }[]).map((p) => [p.id, p.area]))
}

async function loadPeriodRow(db: SupabaseClient, start: ISODate): Promise<PayrollPeriod | null> {
  const { data, error } = await db.from('payroll_periods').select('*').eq('start_date', start).maybeSingle()
  if (error) throw new Error(`payroll_periods: ${error.message}`)
  return (data as PayrollPeriod | null) ?? null
}

async function loadDays(db: SupabaseClient, from: ISODate, to: ISODate): Promise<PayrollDay[]> {
  const { data, error } = await db.from('payroll_days').select('*').gte('work_date', from).lte('work_date', to)
  if (error) throw new Error(`payroll_days: ${error.message}`)
  return (data ?? []) as PayrollDay[]
}

export function assertPeriodStart(start: unknown): asserts start is ISODate {
  if (!isIsoDate(start) || !isPeriodStart(start)) throw new PayrollError('El corte debe empezar en sábado (YYYY-MM-DD)')
}

export async function loadPayrollView(db: SupabaseClient, start: ISODate): Promise<PayrollView> {
  assertPeriodStart(start)
  const dates = periodDates(start)
  const [employees, days, period, areas] = await Promise.all([
    loadEmployees(db),
    loadDays(db, dates[0], dates[6]),
    loadPeriodRow(db, start),
    loadProfileAreas(db),
  ])
  return buildPayrollView(start, employees, days, period, areas)
}

export interface DayInput {
  employee_id: string
  work_date: ISODate
  worked_minutes: number
  missed_minutes?: number
  note?: string | null
}

export interface SaveDaysResult {
  saved: number
  /** Days left untouched, with the reason, so nothing is skipped in silence. */
  skipped: { employee_id: string; work_date: ISODate; reason: string }[]
}

/**
 * Upserts days. `overwrite: false` (sheet, hours prefill) never touches a confirmed day nor one
 * typed by hand — only the admin editing in the app overwrites.
 */
export async function saveDays(
  db: SupabaseClient,
  inputs: readonly DayInput[],
  opts: { source: PayrollDaySource; status: PayrollDayStatus; overwrite: boolean },
): Promise<SaveDaysResult> {
  if (inputs.length === 0) return { saved: 0, skipped: [] }
  for (const d of inputs) {
    if (!isIsoDate(d.work_date)) throw new PayrollError(`Fecha inválida: ${String(d.work_date)}`)
    if (!isDayMinutes(d.worked_minutes)) throw new PayrollError(`Horas trabajadas inválidas el ${d.work_date} (0 a 24 h)`)
    if (d.missed_minutes !== undefined && !isDayMinutes(d.missed_minutes)) {
      throw new PayrollError(`Horas no trabajadas inválidas el ${d.work_date} (0 a 24 h)`)
    }
    if (d.note != null && d.note.length > NOTE_MAX) throw new PayrollError(`La nota no puede pasar de ${NOTE_MAX} caracteres`)
  }
  const keys = new Set<string>()
  for (const d of inputs) {
    const key = `${d.employee_id}|${d.work_date}`
    if (keys.has(key)) throw new PayrollError(`El ${d.work_date} viene repetido para el mismo empleado`)
    keys.add(key)
  }

  const sorted = inputs.map((d) => d.work_date).sort()
  const starts = [...new Set(inputs.map((d) => payrollPeriod(d.work_date).start))]
  const [existing, closedRes] = await Promise.all([
    loadDays(db, sorted[0], sorted[sorted.length - 1]),
    db.from('payroll_periods').select('start_date').eq('status', 'closed').in('start_date', starts),
  ])
  if (closedRes.error) throw new Error(`payroll_periods: ${closedRes.error.message}`)
  const closed = new Set(((closedRes.data ?? []) as Pick<PayrollPeriod, 'start_date'>[]).map((p) => p.start_date))
  const current = new Map(existing.map((d) => [`${d.employee_id}|${d.work_date}`, d]))

  const skipped: SaveDaysResult['skipped'] = []
  const rows = []
  for (const d of inputs) {
    const skip = (reason: string) => skipped.push({ employee_id: d.employee_id, work_date: d.work_date, reason })
    if (closed.has(payrollPeriod(d.work_date).start)) {
      if (opts.overwrite) throw new PayrollError(`El corte que incluye el ${d.work_date} está cerrado`)
      skip('el corte está cerrado')
      continue
    }
    const before = current.get(`${d.employee_id}|${d.work_date}`)
    if (!opts.overwrite && before?.status === 'confirmed') {
      skip('ya está confirmado')
      continue
    }
    if (!opts.overwrite && before && before.source !== opts.source) {
      skip(before.source === 'manual' ? 'se capturó a mano' : 'ya tiene horas de otro origen')
      continue
    }
    rows.push({
      employee_id: d.employee_id,
      work_date: d.work_date,
      worked_minutes: d.worked_minutes,
      missed_minutes: d.missed_minutes ?? before?.missed_minutes ?? 0,
      note: d.note === undefined ? (before?.note ?? null) : d.note?.trim() || null,
      source: opts.source,
      status: opts.status,
    })
  }
  if (rows.length > 0) {
    const { error } = await db.from('payroll_days').upsert(rows, { onConflict: 'employee_id,work_date' })
    if (error) {
      if (error.code === '23503') throw new PayrollError('El empleado no existe')
      if (error.code === '23514') throw new PayrollError(error.message)
      throw new Error(`payroll_days upsert: ${error.message}`)
    }
  }
  return { saved: rows.length, skipped }
}

export interface PrefillResult extends SaveDaysResult {
  /** Punches without a clock-out: they add nothing, so the admin must know. */
  open: number
  linked: number
  /** Office Saturdays filled with the hours paid without working them (#135). */
  officeSaturdays: number
}

/** Copies the office's clocked hours into the cut as drafts (never over confirmed or manual days). */
export async function prefillFromHours(db: SupabaseClient, start: ISODate): Promise<PrefillResult> {
  assertPeriodStart(start)
  const dates = periodDates(start)
  const linked = (await loadEmployees(db)).filter((e) => e.active && e.profile_id)
  if (linked.length === 0) return { saved: 0, skipped: [], open: 0, linked: 0, officeSaturdays: 0 }
  const areas = await loadProfileAreas(db, linked.map((e) => e.profile_id as string))

  const { data, error } = await db
    .from('time_entries')
    .select('user_id, work_date, source_clock_in, clock_in, clock_out')
    .in('user_id', linked.map((e) => e.profile_id as string))
    .gte('work_date', dates[0])
    .lte('work_date', dates[6])
  if (error) throw new Error(`time_entries: ${error.message}`)
  const entries = ((data ?? []) as Pick<TimeEntry, 'user_id' | 'work_date' | 'source_clock_in' | 'clock_in' | 'clock_out'>[]).map(normalizeEntryTimes)

  const inputs: DayInput[] = []
  const stale: { employee_id: string; work_date: ISODate }[] = []
  let open = 0
  const officeSaturdays = new Set<string>()
  for (const employee of linked) {
    const byDate = minutesByDate(entries.filter((e) => e.user_id === employee.profile_id))
    // The office is paid its Saturday without working it; if it did, the larger of the two, never both (#135).
    if (payrollArea(employee, areas) === 'office') {
      const saturday = byDate.get(dates[0])
      const clocked = saturday?.minutes ?? 0
      const paid = officeSaturdayMinutes(employee.shift)
      open += saturday?.open ?? 0
      byDate.delete(dates[0])
      // The note is always sent: a later prefill where the clock wins must not keep "se pagan 8 h" (review PR #140).
      const note = clocked < paid ? `Sábado de oficina: ${clocked ? `checó ${formatDuration(clocked)}, ` : ''}se pagan ${paid / 60} h` : null
      inputs.push({ employee_id: employee.id, work_date: dates[0], worked_minutes: Math.max(clocked, paid), note })
      if (clocked < paid) officeSaturdays.add(`${employee.id}|${dates[0]}`)
    }
    for (const [work_date, day] of byDate) {
      open += day.open
      // Only an open punch: a gap, not a 0-hour draft that "confirm all" would freeze (review PR #127).
      if (day.minutes === 0 && day.open > 0) {
        stale.push({ employee_id: employee.id, work_date })
        continue
      }
      inputs.push({ employee_id: employee.id, work_date, worked_minutes: day.minutes })
    }
  }
  // Its own earlier draft would survive as a number that looks good (review PR #127): drop it.
  for (const day of stale) {
    const { error } = await db
      .from('payroll_days')
      .delete()
      .eq('employee_id', day.employee_id)
      .eq('work_date', day.work_date)
      .eq('source', 'hours')
      .eq('status', 'draft')
    if (error?.code === '23514') throw new PayrollError(error.message)
    if (error) throw new Error(`payroll_days stale draft: ${error.message}`)
  }
  const result = await saveDays(db, inputs, { source: 'hours', status: 'draft', overwrite: false })
  for (const s of result.skipped) officeSaturdays.delete(`${s.employee_id}|${s.work_date}`)
  return { ...result, open, linked: linked.length, officeSaturdays: officeSaturdays.size }
}

export async function confirmDrafts(db: SupabaseClient, start: ISODate): Promise<number> {
  assertPeriodStart(start)
  const dates = periodDates(start)
  const { data, error } = await db
    .from('payroll_days')
    .update({ status: 'confirmed' })
    .eq('status', 'draft')
    .gte('work_date', dates[0])
    .lte('work_date', dates[6])
    .select('id')
  if (error) {
    if (error.code === '23514') throw new PayrollError(error.message)
    throw new Error(`payroll_days confirm: ${error.message}`)
  }
  return (data ?? []).length
}

/** Closing freezes the cut (the trigger enforces it); a draft left behind would be lost hours. */
export async function setPeriodClosed(
  db: SupabaseClient,
  start: ISODate,
  closed: boolean,
  actorName: string | null,
): Promise<PayrollPeriod> {
  assertPeriodStart(start)
  const now = new Date().toISOString()
  if (closed) {
    const dates = periodDates(start)
    const { count, error } = await db
      .from('payroll_days')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'draft')
      .gte('work_date', dates[0])
      .lte('work_date', dates[6])
    if (error) throw new Error(`payroll_days count: ${error.message}`)
    if ((count ?? 0) > 0) throw new PayrollError(`Hay ${count} días en borrador: confírmalos o bórralos antes de cerrar`)
  }
  if (!closed) {
    // Never closed = nothing to reopen: a "reopened" stamp would record something that did not happen.
    const current = await loadPeriodRow(db, start)
    if (current?.status !== 'closed') {
      return current ?? { start_date: start, status: 'open', closed_at: null, closed_by_name: null, reopened_at: null, reopened_by_name: null }
    }
  }
  const stamp = closed
    ? { status: 'closed', closed_at: now, closed_by_name: actorName }
    : { status: 'open', reopened_at: now, reopened_by_name: actorName }
  const { data, error } = await db
    .from('payroll_periods')
    .upsert({ start_date: start, ...stamp }, { onConflict: 'start_date' })
    .select('*')
    .single()
  if (error || !data) throw new Error(`payroll_periods upsert: ${error?.message ?? 'sin datos'}`)
  return data as PayrollPeriod
}
