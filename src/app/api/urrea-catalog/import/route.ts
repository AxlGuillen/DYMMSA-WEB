import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { importCatalog, parseCatalogSheet } from '@/lib/urrea-catalog-store'
import type { CatalogImportMode, CatalogImportResult } from '@/types/database'

// POST /api/urrea-catalog/import — multipart `file` + `mode` (upsert | replace)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const formData = await request.formData()
    const file = formData.get('file')
    const mode: CatalogImportMode = formData.get('mode') === 'replace' ? 'replace' : 'upsert'

    if (!(file instanceof Blob)) {
      return NextResponse.json({ message: 'No se proporcionó archivo' }, { status: 400 })
    }

    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]])

    // The whole file is checked before anything is written (#157).
    const { imported } = await importCatalog(supabase, parseCatalogSheet(rows), mode)

    const result: CatalogImportResult = { imported, updated: 0, errors: 0, total: rows.length, mode }
    return NextResponse.json(result)
  } catch (error) {
    return apiError(error, 'Error al procesar el archivo', 'URREA catalog import error:')
  }
}
