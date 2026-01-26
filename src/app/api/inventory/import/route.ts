import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'

interface ExcelRow {
  MODEL_CODE?: string
  QUANTITY?: number | string
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
    const mode = formData.get('mode') as string || 'upsert' // 'upsert' or 'replace'

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

    // Validate required columns
    const firstRow = rows[0]
    if (!('MODEL_CODE' in firstRow)) {
      return NextResponse.json(
        { message: 'Columna faltante: MODEL_CODE' },
        { status: 400 }
      )
    }

    // If replace mode, delete all existing inventory first
    if (mode === 'replace') {
      const { error: deleteError } = await supabase
        .from('store_inventory')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all

      if (deleteError) {
        console.error('Error deleting inventory:', deleteError)
        return NextResponse.json(
          { message: 'Error al limpiar inventario existente' },
          { status: 500 }
        )
      }
    }

    let imported = 0
    let updated = 0
    let errors = 0

    for (const row of rows) {
      if (!row.MODEL_CODE) {
        errors++
        continue
      }

      const modelCode = String(row.MODEL_CODE).trim()
      const quantity = typeof row.QUANTITY === 'number'
        ? row.QUANTITY
        : parseInt(String(row.QUANTITY || '0'), 10) || 0

      // Ensure quantity is not negative
      const safeQuantity = Math.max(0, quantity)

      if (mode === 'replace') {
        // In replace mode, just insert all
        const { error } = await supabase
          .from('store_inventory')
          .insert({ model_code: modelCode, quantity: safeQuantity })

        if (error) {
          console.error(`Error inserting ${modelCode}:`, error.message)
          errors++
        } else {
          imported++
        }
      } else {
        // Upsert mode
        const { data: existing } = await supabase
          .from('store_inventory')
          .select('id')
          .eq('model_code', modelCode)
          .single()

        if (existing) {
          // Update
          const { error } = await supabase
            .from('store_inventory')
            .update({ quantity: safeQuantity })
            .eq('model_code', modelCode)

          if (error) {
            errors++
          } else {
            updated++
          }
        } else {
          // Insert
          const { error } = await supabase
            .from('store_inventory')
            .insert({ model_code: modelCode, quantity: safeQuantity })

          if (error) {
            errors++
          } else {
            imported++
          }
        }
      }
    }

    return NextResponse.json({
      imported,
      updated,
      errors,
      total: rows.length,
      mode,
    })
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json(
      { message: 'Error al procesar el archivo' },
      { status: 500 }
    )
  }
}
