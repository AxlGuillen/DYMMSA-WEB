import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, forbidden, serverError } from '@/lib/api-helpers'
import { parseNgtecoReport } from '@/lib/timesheet'
import type { Profile, TimeImportResult } from '@/types/database'

const SHEET = 'Employee Timecard'
// The weekly report is ~30 KB; anything near this is not the clock's file.
const MAX_FILE_BYTES = 5 * 1024 * 1024

// POST /api/time-entries/import — the weekly NGTeco .xls (admin). Unmapped employees are
// reported, not fatal; the write goes through the transactional RPC so edited rows survive.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) return badRequest('No se proporcionó archivo')
    if (file.size > MAX_FILE_BYTES) return badRequest('El archivo supera 5 MB: ¿es el reporte del checador?')

    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const worksheet = workbook.Sheets[SHEET] ?? workbook.Sheets[workbook.SheetNames[0]]
    if (!worksheet) return badRequest('El archivo no contiene hojas')
    // raw:false → the clock's text as printed; cellText() keeps its numeric branches for a typed export.
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false, defval: '' })

    const report = parseNgtecoReport(rows)
    if (!report.period) return badRequest('El archivo no trae "Período de pago": ¿es el reporte del checador?')
    if (report.employees.length === 0) return badRequest('El archivo no trae bloques de empleado')

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, clock_employee_id')
      .not('clock_employee_id', 'is', null)
    if (profilesError) {
      console.error('Error fetching profiles for import:', profilesError)
      return serverError('Error al leer los perfiles')
    }
    const byClockId = new Map(
      ((profiles ?? []) as Pick<Profile, 'id' | 'clock_employee_id'>[]).map((p) => [p.clock_employee_id, p.id]),
    )

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

    const result: TimeImportResult = {
      period: report.period,
      inserted: 0,
      updated: 0,
      skipped_edited: 0,
      unmapped,
      warnings,
    }
    if (entries.length === 0) return NextResponse.json(result)

    const { data, error } = await supabase.rpc('import_time_entries', {
      p_entries: entries,
      p_period_start: report.period.start,
      p_period_end: report.period.end,
      p_file_name: file.name,
    })
    if (error) {
      if (error.code === '42501') return forbidden()
      if (error.code === '23514') return badRequest('El reporte trae una salida anterior a su entrada')
      console.error('Error importing time entries:', error)
      return serverError('Error al importar las checadas')
    }
    const counts = (data ?? {}) as Partial<Pick<TimeImportResult, 'inserted' | 'updated' | 'skipped_edited'>>
    return NextResponse.json({
      ...result,
      inserted: counts.inserted ?? 0,
      updated: counts.updated ?? 0,
      skipped_edited: counts.skipped_edited ?? 0,
    })
  } catch (error) {
    console.error('Time entries import error:', error)
    return serverError('Error al importar las checadas')
  }
}
