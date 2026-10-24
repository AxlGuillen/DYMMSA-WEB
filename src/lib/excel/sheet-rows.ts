/** Helpers for the import routes, which check a whole sheet before writing anything (#157). */

export type SheetRow = Record<string, unknown>

/** An empty cell: missing, null or only spaces. */
export const isBlankCell = (value: unknown): boolean => value == null || String(value).trim() === ''

/** The cell as trimmed text ('' when blank). */
export const cellText = (value: unknown): string => (value == null ? '' : String(value).trim())

/** The spreadsheet row number (header = row 1); SheetJS keeps it in `__rowNum__` even past skipped blank rows. */
export function sheetRowNumber(row: SheetRow, index: number): number {
  const rowNum = (row as { __rowNum__?: unknown }).__rowNum__
  return typeof rowNum === 'number' ? rowNum + 1 : index + 2
}

/** Every column header in the sheet: sheet_to_json drops the blank cells of each row. */
export function sheetHeaders(rows: readonly SheetRow[]): Set<string> {
  return new Set(rows.flatMap((row) => Object.keys(row).map((key) => key.trim())))
}

/** The issues of a file as one message: the first `limit`, then how many more. */
export function listIssues(intro: string, issues: readonly string[], limit = 8): string {
  const rest = issues.length - limit
  return `${intro} ${issues.slice(0, limit).join(' ')}${rest > 0 ? ` …y ${rest} más.` : ''}`
}
