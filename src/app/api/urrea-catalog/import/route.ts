import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { parseNumber, parseInteger } from '@/lib/format'
import { normalizeCatalogCode } from '@/lib/business-rules'
import type { UrreaCatalogInsert } from '@/types/database'

type RawRow = Record<string, unknown>

/** Lee una columna por varios alias (case-insensitive). */
function pick(row: RawRow, keys: string[]): unknown {
  const lowerMap = new Map(
    Object.keys(row).map((k) => [k.trim().toLowerCase(), row[k]])
  )
  for (const k of keys) {
    const v = lowerMap.get(k)
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return undefined
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const formData = await request.formData()
    const file = formData.get('file') as File
    const mode = (formData.get('mode') as string) || 'upsert' // 'upsert' | 'replace'

    if (!file) {
      return NextResponse.json({ message: 'No se proporcionó archivo' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<RawRow>(worksheet)

    if (rows.length === 0) {
      return NextResponse.json({ message: 'El archivo no contiene datos' }, { status: 400 })
    }

    // Validar que exista la columna de código
    if (pick(rows[0], ['codigo', 'código', 'code']) === undefined) {
      return NextResponse.json(
        { message: 'Columna faltante: codigo (o code)' },
        { status: 400 }
      )
    }

    // Normalizar filas
    const payload: UrreaCatalogInsert[] = []
    let errors = 0
    for (const row of rows) {
      const code = pick(row, ['codigo', 'código', 'code'])
      if (code === undefined) {
        errors++
        continue
      }
      const std = parseInteger(pick(row, ['std']))
      payload.push({
        // Normalizada (trim+upper): es la llave de cruce con model_code para
        // resolver la Descripción DYMMSA; sin normalizar, el match falla en silencio.
        code: normalizeCatalogCode(String(code)),
        description: ((pick(row, ['descripcion', 'descripción', 'description']) as string) ?? null) || null,
        std: std != null && std > 0 ? std : 1,
        price: parseNumber(pick(row, ['precio', 'price'])),
      })
    }

    if (payload.length === 0) {
      return NextResponse.json({ message: 'No hay filas válidas en el archivo' }, { status: 400 })
    }

    if (mode === 'replace') {
      const { error: deleteError } = await supabase
        .from('urrea_catalog')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000') // borra todo

      if (deleteError) {
        console.error('Error clearing urrea_catalog:', deleteError)
        return NextResponse.json({ message: 'Error al limpiar el catálogo existente' }, { status: 500 })
      }

      const { error: insertError } = await supabase.from('urrea_catalog').insert(payload)
      if (insertError) {
        console.error('Error inserting urrea_catalog:', insertError)
        return NextResponse.json({ message: 'Error al insertar el catálogo' }, { status: 500 })
      }
      return NextResponse.json({ imported: payload.length, updated: 0, errors, total: rows.length, mode })
    }

    // upsert por code
    const { error: upsertError } = await supabase
      .from('urrea_catalog')
      .upsert(payload, { onConflict: 'code' })

    if (upsertError) {
      console.error('Error upserting urrea_catalog:', upsertError)
      return NextResponse.json({ message: 'Error al importar el catálogo' }, { status: 500 })
    }

    return NextResponse.json({ imported: payload.length, updated: 0, errors, total: rows.length, mode })
  } catch (error) {
    console.error('URREA catalog import error:', error)
    return NextResponse.json({ message: 'Error al procesar el archivo' }, { status: 500 })
  }
}
