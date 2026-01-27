import ExcelJS from 'exceljs'
import type { ApprovedProduct } from '@/types/database'

// Green colors range (ARGB format without alpha, lowercase)
const GREEN_COLORS = [
  '00ff00', // Bright green
  '00b050', // Dark green
  '92d050', // Light green
  'c6e0b4', // Pale green
  '00ff00', // Pure green
  '008000', // Green
  '00b000', // Medium green
  '90ee90', // Light green variant
]

/**
 * Check if a color is considered green
 */
function isGreenColor(color: string | undefined): boolean {
  if (!color) return false
  // Remove alpha channel if present (first 2 characters for ARGB)
  const normalizedColor = color.length === 8 ? color.slice(2).toLowerCase() : color.toLowerCase()

  // Check if it's in our list of known greens
  if (GREEN_COLORS.includes(normalizedColor)) return true

  // Check if it's a greenish color (high green component, low red and blue)
  if (normalizedColor.length === 6) {
    const r = parseInt(normalizedColor.slice(0, 2), 16)
    const g = parseInt(normalizedColor.slice(2, 4), 16)
    const b = parseInt(normalizedColor.slice(4, 6), 16)

    // Consider it green if green is dominant and relatively high
    if (g >= 150 && g > r * 1.5 && g > b * 1.5) return true
    // Also consider light greens where all are high but green is highest
    if (g >= 180 && g > r && g > b && r < 220) return true
  }

  return false
}

/**
 * Check if a row has any cell with green background
 */
function isRowGreen(row: ExcelJS.Row): boolean {
  let hasGreen = false

  row.eachCell({ includeEmpty: false }, (cell) => {
    if (hasGreen) return // Already found green

    const fill = cell.fill
    if (fill && fill.type === 'pattern' && fill.pattern === 'solid') {
      const fgColor = fill.fgColor
      if (fgColor) {
        // Check argb color
        if (fgColor.argb && isGreenColor(fgColor.argb)) {
          hasGreen = true
        }
        // Check theme color (some Excel files use indexed colors)
        // Theme colors are harder to detect, but we try common green indices
      }
    }
  })

  return hasGreen
}

/**
 * Find column index by header name (case insensitive)
 */
function findColumnIndex(headerRow: ExcelJS.Row, name: string): number | null {
  let foundIndex: number | null = null

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const value = cell.value?.toString().trim().toUpperCase()
    if (value === name.toUpperCase()) {
      foundIndex = colNumber
    }
  })

  return foundIndex
}

/**
 * Get cell value as string
 */
function getCellString(row: ExcelJS.Row, colIndex: number): string {
  const cell = row.getCell(colIndex)
  if (cell.value === null || cell.value === undefined) return ''
  return String(cell.value).trim()
}

/**
 * Get cell value as number
 */
function getCellNumber(row: ExcelJS.Row, colIndex: number): number {
  const cell = row.getCell(colIndex)
  if (cell.value === null || cell.value === undefined) return 0
  const num = Number(cell.value)
  return isNaN(num) ? 0 : num
}

export interface DetectionResult {
  products: ApprovedProduct[]
  sheetsProcessed: number
  sheetsWithData: number
  totalRowsScanned: number
  greenRowsFound: number
}

/**
 * Detect approved products from Excel file
 * Looks for rows with green background in any cell
 * Expected columns: ETM, description, description_es, model_code, quantity, price
 */
export async function detectApprovedProducts(buffer: ArrayBuffer): Promise<DetectionResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const products: ApprovedProduct[] = []
  let sheetsWithData = 0
  let totalRowsScanned = 0
  let greenRowsFound = 0

  for (const worksheet of workbook.worksheets) {
    // Get header row (first row)
    const headerRow = worksheet.getRow(1)
    if (!headerRow || headerRow.cellCount === 0) continue

    // Find column indices
    const etmCol = findColumnIndex(headerRow, 'ETM')
    const descCol = findColumnIndex(headerRow, 'DESCRIPTION')
    const descEsCol = findColumnIndex(headerRow, 'DESCRIPTION_ES')
    const modelCol = findColumnIndex(headerRow, 'MODEL_CODE')
    const qtyCol = findColumnIndex(headerRow, 'QUANTITY')
    const priceCol = findColumnIndex(headerRow, 'PRICE')

    // Skip sheet if no ETM column found
    if (!etmCol) continue

    sheetsWithData++

    // Process data rows (skip header)
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return // Skip header

      totalRowsScanned++

      // Check if row is green
      if (!isRowGreen(row)) return

      greenRowsFound++

      // Extract product data
      const etm = getCellString(row, etmCol)
      if (!etm) return // Skip if no ETM

      const product: ApprovedProduct = {
        etm,
        description: descCol ? getCellString(row, descCol) : '',
        description_es: descEsCol ? getCellString(row, descEsCol) : '',
        model_code: modelCol ? getCellString(row, modelCol) : '',
        quantity: qtyCol ? getCellNumber(row, qtyCol) : 1,
        price: priceCol ? getCellNumber(row, priceCol) : 0,
      }

      products.push(product)
    })
  }

  return {
    products,
    sheetsProcessed: workbook.worksheets.length,
    sheetsWithData,
    totalRowsScanned,
    greenRowsFound,
  }
}
