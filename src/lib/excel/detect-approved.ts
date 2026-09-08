import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import type { ApprovedProduct } from '@/types/database'

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

// ExcelJS types Color as { argb } only, but at runtime it also carries
// theme/tint (Office theme colors) and indexed (legacy palette).
interface FillColor {
  argb?: string
  theme?: number
  tint?: number
  indexed?: number
}

/** The 10 theme base colors (dk1..accent6) from theme1.xml, hex without '#'. */
async function loadThemeColors(buffer: ArrayBuffer): Promise<string[]> {
  try {
    const zip = await JSZip.loadAsync(buffer)
    const themeXml = await zip.file('xl/theme/theme1.xml')?.async('string')
    if (!themeXml) return []

    const parser = new DOMParser()
    const doc = parser.parseFromString(themeXml, 'application/xml')
    const clrScheme = doc.getElementsByTagNameNS(DRAWING_NS, 'clrScheme')[0]
    if (!clrScheme) return []

    const names = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']
    return names.map((name) => {
      const el = clrScheme.getElementsByTagNameNS(DRAWING_NS, name)[0]
      if (!el) return ''
      const srgb = el.getElementsByTagNameNS(DRAWING_NS, 'srgbClr')[0]
      if (srgb) return srgb.getAttribute('val')?.toLowerCase() ?? ''
      const sys = el.getElementsByTagNameNS(DRAWING_NS, 'sysClr')[0]
      if (sys) return sys.getAttribute('lastClr')?.toLowerCase() ?? ''
      return ''
    })
  } catch {
    return []
  }
}

/** Excel tint: > 0 lightens toward white, < 0 darkens toward black. */
function applyTint(hex: string, tint: number): string {
  if (!hex || hex.length !== 6) return hex
  const ch = (raw: number) => {
    const n = raw / 255
    const t = tint >= 0 ? n + (1 - n) * tint : n * (1 + tint)
    return Math.round(Math.min(1, Math.max(0, t)) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return (
    ch(parseInt(hex.slice(0, 2), 16)) +
    ch(parseInt(hex.slice(2, 4), 16)) +
    ch(parseInt(hex.slice(4, 6), 16))
  )
}

/** Green by HSL range (hue 70-165°, sat >15%, light 15-93%): covers olives, excludes grays. */
function isGreenColor(hex: string): boolean {
  if (!hex || hex.length !== 6) return false

  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255

  // Green must be the strictly dominant channel
  if (g <= r || g <= b) return false

  // HSL conversion (max = g since green is already dominant)
  const min = Math.min(r, b)
  const delta = g - min
  const l = (g + min) / 2

  // Exclude near-black and near-white
  if (l < 0.15 || l > 0.93) return false

  // Minimum saturation to exclude near-gray colors
  const s = delta / (l > 0.5 ? 2 - g - min : g + min)
  if (s < 0.15) return false

  // Hue when green is max: h = 60 * ((b - r) / delta + 2)
  // Valid green range: 70°–165°
  const h = 60 * ((b - r) / delta + 2)
  return h >= 70 && h <= 165
}

/** Handles both explicit ARGB and Excel theme colors (theme index + tint). */
function resolveFillHex(
  fgColor: FillColor,
  themeColors: string[]
): string | undefined {
  if (fgColor.argb) {
    // Strip alpha channel from ARGB (first 2 chars)
    const hex = fgColor.argb.length === 8
      ? fgColor.argb.slice(2).toLowerCase()
      : fgColor.argb.toLowerCase()
    return hex.length === 6 ? hex : undefined
  }

  if (fgColor.theme !== undefined && themeColors[fgColor.theme]) {
    const base = themeColors[fgColor.theme]
    return fgColor.tint !== undefined ? applyTint(base, fgColor.tint) : base
  }

  return undefined
}

function isRowGreen(row: ExcelJS.Row, themeColors: string[]): boolean {
  let hasGreen = false

  row.eachCell({ includeEmpty: false }, (cell) => {
    if (hasGreen) return

    const fill = cell.fill
    if (fill?.type === 'pattern' && fill.pattern === 'solid' && fill.fgColor) {
      const hex = resolveFillHex(fill.fgColor as FillColor, themeColors)
      if (hex && isGreenColor(hex)) hasGreen = true
    }
  })

  return hasGreen
}

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

function getCellString(row: ExcelJS.Row, colIndex: number): string {
  const cell = row.getCell(colIndex)
  if (cell.value === null || cell.value === undefined) return ''
  return String(cell.value).trim()
}

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

/** Approved = green background on any cell (direct hex or Office theme color). */
export async function detectApprovedProducts(buffer: ArrayBuffer): Promise<DetectionResult> {
  // Loaded first: needed to resolve theme-based cell backgrounds
  const themeColors = await loadThemeColors(buffer)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const products: ApprovedProduct[] = []
  let sheetsWithData = 0
  let totalRowsScanned = 0
  let greenRowsFound = 0

  for (const worksheet of workbook.worksheets) {
    const headerRow = worksheet.getRow(1)
    if (!headerRow || headerRow.cellCount === 0) continue

    const etmCol = findColumnIndex(headerRow, 'ETM')
    const descCol = findColumnIndex(headerRow, 'DESCRIPTION')
    const descEsCol = findColumnIndex(headerRow, 'DESCRIPTION_ES')
    const modelCol = findColumnIndex(headerRow, 'MODEL_CODE')
    const qtyCol = findColumnIndex(headerRow, 'QUANTITY')
    const priceCol = findColumnIndex(headerRow, 'PRICE')
    const brandCol = findColumnIndex(headerRow, 'BRAND')

    if (!etmCol) continue

    sheetsWithData++

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return

      totalRowsScanned++

      if (!isRowGreen(row, themeColors)) return

      greenRowsFound++

      const etm = getCellString(row, etmCol)
      if (!etm) return

      products.push({
        etm,
        description: descCol ? getCellString(row, descCol) : '',
        description_es: descEsCol ? getCellString(row, descEsCol) : '',
        model_code: modelCol ? getCellString(row, modelCol) : '',
        quantity: qtyCol ? getCellNumber(row, qtyCol) : 1,
        price: priceCol ? getCellNumber(row, priceCol) : 0,
        brand: brandCol ? getCellString(row, brandCol) : '',
      })
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
