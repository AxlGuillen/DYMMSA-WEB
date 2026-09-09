/** Request builders and response readers for route-handler tests. */

import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'

interface RequestOptions {
  method?: string
  url?: string
}

/** NextRequest with a JSON body; `body` undefined attaches none (GET/DELETE). */
export function makeRequest(body?: unknown, opts: RequestOptions = {}): NextRequest {
  const url = opts.url ?? 'http://localhost/api/test'
  const method = opts.method ?? (body !== undefined ? 'POST' : 'GET')
  return new NextRequest(url, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  })
}

/** Wraps dynamic params as the Promise Next 16 hands to handlers. */
export function makeParams<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) }
}

/** Reads the JSON of a handler Response. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T
}

interface ExcelRequestOptions {
  /** `mode` field value (upsert | replace). */
  mode?: string
  /** Skip the file, to exercise the "no file" 400. */
  omitFile?: boolean
}

interface SheetOptions {
  sheetName?: string
  fileName?: string
  bookType?: XLSX.BookType
}

function buildExcelRequest(ws: XLSX.WorkSheet | null, fields: Record<string, string>, sheet: SheetOptions): NextRequest {
  const fd = new FormData()
  if (ws) {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName ?? 'Sheet1')
    const bookType = sheet.bookType ?? 'xlsx'
    const buf = XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer
    fd.set('file', new File([buf], sheet.fileName ?? `data.${bookType}`))
  }
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return new NextRequest('http://localhost/api/test', { method: 'POST', body: fd })
}

/** Multipart NextRequest with a real .xlsx built from flat `rows`, for import handlers. */
export function makeExcelRequest(
  rows: Record<string, unknown>[],
  opts: ExcelRequestOptions = {},
): NextRequest {
  const ws = opts.omitFile ? null : XLSX.utils.json_to_sheet(rows)
  return buildExcelRequest(ws, opts.mode ? { mode: opts.mode } : {}, {})
}

/**
 * Multipart NextRequest from a cell matrix, for sheets that are not a flat table
 * (the NGTeco clock report: blocks per employee, blank cells). Defaults to a real
 * BIFF `.xls`, which is what the clock exports.
 */
export function makeExcelRequestFromRows(
  rows: unknown[][],
  opts: SheetOptions & { omitFile?: boolean } = {},
): NextRequest {
  const ws = opts.omitFile ? null : XLSX.utils.aoa_to_sheet(rows)
  return buildExcelRequest(ws, {}, {
    sheetName: opts.sheetName ?? 'Employee Timecard',
    fileName: opts.fileName ?? 'NGTimereport.xls',
    bookType: opts.bookType ?? 'xls',
  })
}
