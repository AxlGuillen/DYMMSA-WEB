import * as XLSX from 'xlsx'

export interface ExtractionResult {
  etmCodes: string[]
  sheetsProcessed: number
  sheetsWithEtm: number
  totalRowsScanned: number
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
