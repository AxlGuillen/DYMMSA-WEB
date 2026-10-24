import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { DomainError } from '@/lib/domain-error'
import { importCatalog, parseCatalogSheet, type CatalogImportMode } from '@/lib/urrea-catalog-store'

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
    const payload = parseCatalogSheet(rows)
    const { imported } = await importCatalog(supabase, payload, mode)

    return NextResponse.json({ imported, updated: 0, errors: 0, total: rows.length, mode })
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json(error.body, { status: error.status })
    console.error('URREA catalog import error:', error)
    return NextResponse.json({ message: 'Error al procesar el archivo' }, { status: 500 })
  }
}
