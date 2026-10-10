import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, forbidden, serverError } from '@/lib/api-helpers'
import { parseNgtecoReport } from '@/lib/timesheet'
import { importTimeReport, TimeEntryError } from '@/lib/time-entries-store'

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

    const { result } = await importTimeReport(supabase, parseNgtecoReport(rows), file.name)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof TimeEntryError) return error.kind === 'forbidden' ? forbidden() : badRequest(error.message)
    console.error('Time entries import error:', error)
    return serverError('Error al importar las checadas')
  }
}
