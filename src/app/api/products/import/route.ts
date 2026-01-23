import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'

interface ExcelRow {
  ETM?: string
  DESCRIPTION?: string
  DESCRIPCION?: string
  MODELO?: string
  PRECIO?: number | string
  MARCA?: string
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { message: 'No autorizado' },
        { status: 401 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const mode = formData.get('mode') as string || 'upsert'

    if (!file) {
      return NextResponse.json(
        { message: 'No se proporciono archivo' },
        { status: 400 }
      )
    }

    // Read Excel file
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<ExcelRow>(worksheet)

    if (rows.length === 0) {
      return NextResponse.json(
        { message: 'El archivo no contiene datos' },
        { status: 400 }
      )
    }

    // Validate columns
    const firstRow = rows[0]
    const requiredColumns = ['ETM', 'MODELO']
    const missingColumns = requiredColumns.filter(
      (col) => !(col in firstRow)
    )

    if (missingColumns.length > 0) {
      return NextResponse.json(
        { message: `Columnas faltantes: ${missingColumns.join(', ')}` },
        { status: 400 }
      )
    }

    let imported = 0
    let updated = 0
    let errors = 0

    for (const row of rows) {
      if (!row.ETM) {
        errors++
        continue
      }

      const product = {
        etm: String(row.ETM).trim(),
        description: String(row.DESCRIPTION || '').trim(),
        descripcion: String(row.DESCRIPCION || '').trim(),
        modelo: String(row.MODELO || '').trim(),
        precio: typeof row.PRECIO === 'number'
          ? row.PRECIO
          : parseFloat(String(row.PRECIO || '0')) || 0,
        marca: String(row.MARCA || 'URREA').trim(),
        created_by: user.id,
      }

      if (mode === 'upsert') {
        // Check if exists
        const { data: existing } = await supabase
          .from('etm_products')
          .select('id')
          .eq('etm', product.etm)
          .single()

        if (existing) {
          // Update
          const { error } = await supabase
            .from('etm_products')
            .update({
              ...product,
              updated_at: new Date().toISOString(),
            })
            .eq('etm', product.etm)

          if (error) {
            errors++
          } else {
            updated++
          }
        } else {
          // Insert
          const { error } = await supabase
            .from('etm_products')
            .insert(product)

          if (error) {
            errors++
          } else {
            imported++
          }
        }
      } else {
        // Insert only mode
        const { error } = await supabase
          .from('etm_products')
          .insert(product)

        if (error) {
          if (error.code === '23505') {
            // Duplicate, skip
            errors++
          } else {
            errors++
          }
        } else {
          imported++
        }
      }
    }

    return NextResponse.json({
      imported,
      updated,
      errors,
      total: rows.length,
    })
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json(
      { message: 'Error al procesar el archivo' },
      { status: 500 }
    )
  }
}
