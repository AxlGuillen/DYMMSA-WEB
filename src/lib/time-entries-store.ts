/**
 * Clock punch writes shared by the routes and the MCP (#132, #134): the NGTeco import, an admin
 * correction and a manual punch. The client comes from the caller, so `is_admin()` is the gate.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isRealDate, normalizeEntryTimes, normalizeTime, type ParsedReport } from '@/lib/timesheet'
import type { Profile, TimeEntry, TimeEntryUpdate, TimeImportResult } from '@/types/database'

/** A rule the user broke (→ 400 / 404 / 403, or a ToolError); anything else is a real failure. */
export class TimeEntryError extends Error {
  constructor(message: string, readonly kind: 'invalid' | 'not_found' | 'forbidden' = 'invalid') {
    super(message)
    this.name = 'TimeEntryError'
  }
}

export type ClockProfile = Pick<Profile, 'id' | 'display_name' | 'clock_employee_id'>

/** People the clock report maps to, by the "(id)" next to their name. */
export async function loadClockProfiles(db: SupabaseClient): Promise<ClockProfile[]> {
  const { data, error } = await db.from('profiles').select('id, display_name, clock_employee_id').not('clock_employee_id', 'is', null)
  if (error) throw new Error(`profiles: ${error.message}`)
  return (data ?? []) as ClockProfile[]
}

export interface TimeImportOutcome {
  result: TimeImportResult
  /** People with a clock id that the report did not bring: a dropped block reads like this. */
  absent: string[]
}

export async function importTimeReport(db: SupabaseClient, report: ParsedReport, fileName: string): Promise<TimeImportOutcome> {
  if (!report.period) throw new TimeEntryError('El archivo no trae "Período de pago": ¿es el reporte del checador?')
  if (report.employees.length === 0) throw new TimeEntryError('El archivo no trae bloques de empleado')

  const clockProfiles = await loadClockProfiles(db)
  const byClockId = new Map(clockProfiles.map((p) => [p.clock_employee_id, p.id]))

  const entries: { user_id: string; work_date: string; clock_in: string; clock_out: string | null }[] = []
  const unmapped: TimeImportResult['unmapped'] = []
  const warnings = [...report.warnings]
  for (const employee of report.employees) {
    const userId = employee.clockId != null ? byClockId.get(employee.clockId) : undefined
    if (!userId) {
      unmapped.push({ clockId: employee.clockId ?? 0, name: employee.name })
      continue
    }
    for (const p of employee.punches) {
      // The CHECK would reject it and, the RPC being transactional, sink the whole file (ADR-009).
      if (p.clockOut && p.clockOut < p.clockIn) {
        warnings.push(`Salida antes de la entrada: ${employee.name} ${p.date} ${p.clockIn}–${p.clockOut}`)
        continue
      }
      entries.push({ user_id: userId, work_date: p.date, clock_in: p.clockIn, clock_out: p.clockOut })
    }
  }

  const reported = new Set(report.employees.map((e) => e.clockId))
  const absent = clockProfiles.filter((p) => !reported.has(p.clock_employee_id)).map((p) => p.display_name)
  const result: TimeImportResult = { period: report.period, inserted: 0, updated: 0, skipped_edited: 0, unmapped, warnings }
  if (entries.length === 0) return { result, absent }

  const { data, error } = await db.rpc('import_time_entries', {
    p_entries: entries,
    p_period_start: report.period.start,
    p_period_end: report.period.end,
    p_file_name: fileName,
  })
  if (error) {
    if (error.code === '42501') throw new TimeEntryError('Solo un administrador puede cargar el reporte del checador', 'forbidden')
    if (error.code === '23514') throw new TimeEntryError('El reporte trae una salida anterior a su entrada')
    throw new Error(`import_time_entries: ${error.message}`)
  }
  const counts = (data ?? {}) as Partial<Pick<TimeImportResult, 'inserted' | 'updated' | 'skipped_edited'>>
  return {
    result: { ...result, inserted: counts.inserted ?? 0, updated: counts.updated ?? 0, skipped_edited: counts.skipped_edited ?? 0 },
    absent,
  }
}

/** '' or null clears the clock-out; anything else must be a time. */
function parseClockOut(value: unknown): string | null {
  if (value === null || value === '') return null
  const t = typeof value === 'string' ? normalizeTime(value) : null
  if (!t) throw new TimeEntryError('Hora de salida inválida')
  return t
}

/** Admin correction: source_clock_in is never touched and only a time change seals the trace (ADR-026). */
export async function correctTimeEntry(db: SupabaseClient, id: string, body: TimeEntryUpdate, editorId: string): Promise<TimeEntry> {
  const { data: current } = await db.from('time_entries').select('*').eq('id', id).single()
  if (!current) throw new TimeEntryError('La checada no existe', 'not_found')
  const row = normalizeEntryTimes(current as TimeEntry)

  const updates: Record<string, unknown> = {}
  let clockIn = row.clock_in
  let clockOut = row.clock_out
  if (body.clock_in !== undefined) {
    const t = typeof body.clock_in === 'string' ? normalizeTime(body.clock_in) : null
    if (!t) throw new TimeEntryError('Hora de entrada inválida')
    clockIn = t
    updates.clock_in = t
  }
  if (body.clock_out !== undefined) {
    clockOut = parseClockOut(body.clock_out)
    updates.clock_out = clockOut
  }
  if (body.note !== undefined) updates.note = typeof body.note === 'string' ? body.note.trim() || null : null
  if (Object.keys(updates).length === 0) throw new TimeEntryError('No hay cambios para guardar')
  if (clockOut !== null && clockOut < clockIn) throw new TimeEntryError('La salida no puede ser antes de la entrada')

  // The import skips rows with edited_at: a note alone must not freeze a pair the clock may still complete.
  if (clockIn !== row.clock_in || clockOut !== row.clock_out) {
    updates.edited_by = editorId
    updates.edited_at = new Date().toISOString()
    // Written once: what the clock said survives every later correction.
    if (row.original == null) updates.original = { clock_in: row.clock_in, clock_out: row.clock_out, note: row.note }
  }

  const { data, error } = await db.from('time_entries').update(updates).eq('id', id).select('*').single()
  if (error || !data) {
    if (error?.code === 'PGRST116') throw new TimeEntryError('La checada no existe', 'not_found')
    throw new Error(`time_entries update: ${error?.message}`)
  }
  return normalizeEntryTimes(data as TimeEntry)
}

export interface ManualEntryInput {
  user_id: string
  work_date?: unknown
  clock_in?: unknown
  clock_out?: unknown
  note?: unknown
}

/** A punch the clock never saw (source 'manual'); its clock-in doubles as the import key. */
export async function createManualEntry(db: SupabaseClient, input: ManualEntryInput): Promise<TimeEntry> {
  if (!isRealDate(input.work_date)) throw new TimeEntryError('Fecha inválida')
  const clockIn = typeof input.clock_in === 'string' ? normalizeTime(input.clock_in) : null
  if (!clockIn) throw new TimeEntryError('Hora de entrada inválida')
  const clockOut = input.clock_out === undefined ? null : parseClockOut(input.clock_out)
  if (clockOut !== null && clockOut < clockIn) throw new TimeEntryError('La salida no puede ser antes de la entrada')

  const { data, error } = await db
    .from('time_entries')
    .insert({
      user_id: input.user_id,
      work_date: input.work_date,
      source_clock_in: clockIn,
      clock_in: clockIn,
      clock_out: clockOut,
      note: typeof input.note === 'string' ? input.note.trim() || null : null,
      source: 'manual',
    })
    .select('*')
    .single()
  if (error || !data) {
    if (error?.code === '23505') throw new TimeEntryError('Ya existe una checada con esa entrada ese día')
    if (error?.code === '23503') throw new TimeEntryError('El usuario no existe')
    if (error?.code === '42501') throw new TimeEntryError('Solo un administrador puede registrar checadas', 'forbidden')
    throw new Error(`time_entries insert: ${error?.message}`)
  }
  return normalizeEntryTimes(data as TimeEntry)
}
