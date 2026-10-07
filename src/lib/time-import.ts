/**
 * NGTeco import shared by the route (the .xls) and the MCP (the transcribed rows, #132).
 * The client comes from the caller: the RPC is INVOKER and `is_admin()` is the gate.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedReport } from '@/lib/timesheet'
import type { Profile, TimeImportResult } from '@/types/database'

/** A rule the user broke (→ 400 / ToolError); `forbidden` is the RLS saying no. */
export class TimeImportError extends Error {
  constructor(message: string, readonly forbidden = false) {
    super(message)
    this.name = 'TimeImportError'
  }
}

type ClockProfile = Pick<Profile, 'id' | 'display_name' | 'clock_employee_id'>

export interface TimeImportOutcome {
  result: TimeImportResult
  /** People with a clock id that the report did not bring: a dropped block reads like this. */
  absent: string[]
}

export async function importTimeReport(db: SupabaseClient, report: ParsedReport, fileName: string): Promise<TimeImportOutcome> {
  if (!report.period) throw new TimeImportError('El archivo no trae "Período de pago": ¿es el reporte del checador?')
  if (report.employees.length === 0) throw new TimeImportError('El archivo no trae bloques de empleado')

  const { data: profiles, error: profilesError } = await db
    .from('profiles')
    .select('id, display_name, clock_employee_id')
    .not('clock_employee_id', 'is', null)
  if (profilesError) throw new Error(`profiles: ${profilesError.message}`)
  const clockProfiles = (profiles ?? []) as ClockProfile[]
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
    if (error.code === '42501') throw new TimeImportError('Solo un administrador puede cargar el reporte del checador', true)
    if (error.code === '23514') throw new TimeImportError('El reporte trae una salida anterior a su entrada')
    throw new Error(`import_time_entries: ${error.message}`)
  }
  const counts = (data ?? {}) as Partial<Pick<TimeImportResult, 'inserted' | 'updated' | 'skipped_edited'>>
  return {
    result: { ...result, inserted: counts.inserted ?? 0, updated: counts.updated ?? 0, skipped_edited: counts.skipped_edited ?? 0 },
    absent,
  }
}
