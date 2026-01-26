import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import path from 'path'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables (SUPABASE_SERVICE_ROLE_KEY required)')
  process.exit(1)
}

// Use service role key to bypass RLS
const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface ExcelRow {
  ETM: string
  DESCRIPTION: string
  DESCRIPTION_ES: string
  MODEL_CODE: string
  PRICE: number | string
  BRAND?: string
}

async function migrate() {
  console.log('Starting migration...\n')

  // Read Excel file
  const filePath = path.join(process.cwd(), 'inputs', 'DB-ETM-v1.xlsm')
  console.log(`Reading file: ${filePath}`)

  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(worksheet)

  console.log(`Found ${rows.length} rows in Excel\n`)

  let migrated = 0
  let errors = 0
  let skipped = 0

  for (const row of rows) {
    // Skip rows without ETM
    if (!row.ETM) {
      skipped++
      continue
    }

    const product = {
      etm: String(row.ETM).trim(),
      description: String(row.DESCRIPTION || '').trim(),
      description_es: String(row.DESCRIPTION_ES || '').trim(),
      model_code: String(row.MODEL_CODE || '').trim(),
      price: typeof row.PRICE === 'number' ? row.PRICE : parseFloat(String(row.PRICE)) || 0,
      brand: String(row.BRAND || 'URREA').trim(),
      created_by: null,
    }

    const { error } = await supabase
      .from('etm_products')
      .upsert(product, { onConflict: 'etm' })

    if (error) {
      console.error(`Error inserting ETM ${product.etm}:`, error.message)
      errors++
    } else {
      migrated++
      if (migrated % 50 === 0) {
        console.log(`Progress: ${migrated} products migrated...`)
      }
    }
  }

  console.log('\n========================================')
  console.log(`Migration complete!`)
  console.log(`${migrated} products migrated`)
  console.log(`${errors} errors`)
  console.log(`${skipped} rows skipped (no ETM)`)
  console.log('========================================\n')
}

migrate().catch(console.error)
