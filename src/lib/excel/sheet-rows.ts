/** Helpers for the import routes, which check a whole sheet before writing anything (#157). */

export type SheetRow = Record<string, unknown>

/** An empty cell: missing, null or only spaces. */
export const isBlankCell = (value: unknown): boolean => value == null || String(value).trim() === ''

/** The cell as trimmed text ('' when blank). */
export const cellText = (value: unknown): string => (value == null ? '' : String(value).trim())

const headerKey = (header: string) => header.trim().toLowerCase()

/** A cell by any of its column aliases; headers match ignoring case and stray spaces ("ETM " = "etm"). */
export function pick(row: SheetRow, aliases: readonly string[]): unknown {
  const byHeader = new Map(Object.keys(row).map((key) => [headerKey(key), row[key]]))
  for (const alias of aliases) {
    const value = byHeader.get(headerKey(alias))
    if (!isBlankCell(value)) return value
  }
  return undefined
}

/** Every column header in the sheet, trimmed and lowercased: sheet_to_json drops the blank cells of each row. */
export function sheetHeaders(rows: readonly SheetRow[]): Set<string> {
  return new Set(rows.flatMap((row) => Object.keys(row).map(headerKey)))
}

/** Does the sheet have a column under any of these aliases? */
export function hasColumn(headers: ReadonlySet<string>, aliases: readonly string[]): boolean {
  return aliases.some((alias) => headers.has(headerKey(alias)))
}

/** The spreadsheet row number (header = row 1); SheetJS keeps it in `__rowNum__` even past skipped blank rows. */
export function sheetRowNumber(row: SheetRow, index: number): number {
  const rowNum = (row as { __rowNum__?: unknown }).__rowNum__
  return typeof rowNum === 'number' ? rowNum + 1 : index + 2
}

/** The issues of a file as one message, one per line: the first `limit`, then how many more. */
export function listIssues(intro: string, issues: readonly string[], limit = 8): string {
  const rest = issues.length - limit
  return [intro, ...issues.slice(0, limit), ...(rest > 0 ? [`…y ${rest} más.`] : [])].join('\n')
}
