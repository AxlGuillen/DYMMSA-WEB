import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { importProducts, parseProductSheet } from '@/lib/products-store'
import type { ProductImportMode, ProductImportResult } from '@/types/database'

// POST /api/products/import — multipart `file` + `mode` (upsert | insert = only new ETMs)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const formData = await request.formData()
    const file = formData.get('file')
    const mode: ProductImportMode = (formData.get('mode') ?? 'upsert') === 'upsert' ? 'upsert' : 'insert'

    if (!(file instanceof Blob)) {
      return NextResponse.json({ message: 'No se proporciono archivo' }, { status: 400 })
    }

    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]])

    // The whole file is checked before anything is written (#157).
    const { rows, withoutEtm } = parseProductSheet(sheet)
    const written = await importProducts(supabase, auth.user.id, rows, mode)

    const result: ProductImportResult = { ...written, errors: written.errors + withoutEtm, total: sheet.length }
    return NextResponse.json(result)
  } catch (error) {
    return apiError(error, 'Error al procesar el archivo', 'Import error:')
  }
}
