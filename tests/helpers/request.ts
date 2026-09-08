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

/** Multipart NextRequest with a real .xlsx built from `rows`, for import handlers. */
export function makeExcelRequest(
  rows: Record<string, unknown>[],
  opts: ExcelRequestOptions = {},
): NextRequest {
  const fd = new FormData()
  if (!opts.omitFile) {
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    fd.set('file', new File([buf], 'data.xlsx'))
  }
  if (opts.mode) fd.set('mode', opts.mode)
  return new NextRequest('http://localhost/api/test', { method: 'POST', body: fd })
}
