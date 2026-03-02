import * as XLSX from 'xlsx'
import type { ExcelExtractedRow } from '@/types/database'

export interface ExtractionResult {
  etmCodes: string[]
  sheetsProcessed: number
  sheetsWithEtm: number
  totalRowsScanned: number
}

export interface ExtractionProductResult {
  rows: ExcelExtractedRow[]
  sheetsProcessed: number
  sheetsWithEtm: number
}

// Maps logical field names to possible column headers in the Excel (case insensitive)
const COLUMN_ALIASES: Record<string, string[]> = {
  etm: ['etm'],
  description: ['description', 'descripcion', 'desc'],
  description_es: ['description_es', 'descripcion_es', 'desc_es'],
  model_code: ['model_code', 'modelo', 'cod_modelo', 'codigo_modelo', 'model'],
  quantity: ['quantity', 'cantidad', 'qty', 'cant'],
  price: ['price', 'precio'],
  brand: ['brand', 'marca'],
}

function findColumnHeader(headers: string[], aliases: string[]): string | null {
  const normalized = headers.map((h) => h.toLowerCase().trim())
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias)
    if (idx !== -1) return headers[idx]
  }
  return null
}

/**
 * Extrae todas las filas de producto de un Excel multi-hoja.
 * Solo ETM es obligatorio; los demás campos se extraen si la columna existe.
 * Deduplica por ETM (primera aparición gana).
 */
export function extractProductRowsFromExcel(buffer: ArrayBuffer): ExtractionProductResult {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const rowMap = new Map<string, ExcelExtractedRow>()
  let sheetsWithEtm = 0

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet)
    if (jsonRows.length === 0) continue

    const headers = Object.keys(jsonRows[0])
    const etmCol = findColumnHeader(headers, COLUMN_ALIASES.etm)
    if (!etmCol) continue

    sheetsWithEtm++

    const descCol    = findColumnHeader(headers, COLUMN_ALIASES.description)
    const descEsCol  = findColumnHeader(headers, COLUMN_ALIASES.description_es)
    const modelCol   = findColumnHeader(headers, COLUMN_ALIASES.model_code)
    const qtyCol     = findColumnHeader(headers, COLUMN_ALIASES.quantity)
    const priceCol   = findColumnHeader(headers, COLUMN_ALIASES.price)
    const brandCol   = findColumnHeader(headers, COLUMN_ALIASES.brand)

    const parseNum = (row: Record<string, unknown>, col: string | null): number | null => {
      if (!col || row[col] == null) return null
      const val = parseFloat(String(row[col]))
      return isNaN(val) ? null : val
    }

    for (const row of jsonRows) {
      const etmRaw = row[etmCol]
      if (etmRaw == null || etmRaw === '') continue
      const etm = String(etmRaw).trim()
      if (!etm || rowMap.has(etm)) continue

      rowMap.set(etm, {
        etm,
        description:    descCol   ? String(row[descCol]   ?? '').trim() : '',
        description_es: descEsCol ? String(row[descEsCol] ?? '').trim() : '',
        model_code:     modelCol  ? String(row[modelCol]  ?? '').trim() : '',
        quantity:       parseNum(row, qtyCol),
        price:          parseNum(row, priceCol),
        brand:          brandCol  ? String(row[brandCol]  ?? '').trim() : '',
      })
    }
  }

  return {
    rows: Array.from(rowMap.values()),
    sheetsProcessed: workbook.SheetNames.length,
    sheetsWithEtm,
  }
}

/**
 * Extrae codigos ETM unicos de todas las hojas de un archivo Excel
 * Busca la columna "ETM" (case insensitive) en cada hoja
 */
export function extractEtmCodesFromExcel(buffer: ArrayBuffer): ExtractionResult {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const etmSet = new Set<string>()
  let totalRows = 0
  let sheetsWithEtm = 0

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet)

    if (rows.length === 0) continue

    // Buscar columna ETM (case insensitive)
    const headers = Object.keys(rows[0])
    const etmColumn = headers.find((h) => h.toUpperCase().trim() === 'ETM')

    if (!etmColumn) continue

    sheetsWithEtm++

    for (const row of rows) {
      totalRows++
      const etmValue = row[etmColumn]
      if (etmValue !== null && etmValue !== undefined && etmValue !== '') {
        // Normalizar el valor ETM (string, sin espacios)
        const normalizedEtm = String(etmValue).trim()
        if (normalizedEtm) {
          etmSet.add(normalizedEtm)
        }
      }
    }
  }

  return {
    etmCodes: Array.from(etmSet),
    sheetsProcessed: workbook.SheetNames.length,
    sheetsWithEtm,
    totalRowsScanned: totalRows,
  }
}
