/**
 * Helpers para construir requests y leer respuestas en tests de route handlers.
 */

import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'

interface RequestOptions {
  method?: string
  url?: string
}

/**
 * Construye un NextRequest con body JSON, listo para pasar a un handler.
 * Si `body` es undefined no se adjunta cuerpo (útil para GET/DELETE).
 */
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

/** Envuelve params dinámicos como la Promise que Next 16 pasa a los handlers. */
export function makeParams<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) }
}

/** Lee el JSON de una Response devuelta por un handler. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T
}

interface ExcelRequestOptions {
  /** Valor del campo `mode` (upsert | replace). */
  mode?: string
  /** Si true, no adjunta el archivo (para probar el 400 "sin archivo"). */
  omitFile?: boolean
}

/**
 * Construye un NextRequest multipart con un .xlsx real generado a partir de
 * `rows`. Usado por los handlers de import que llaman `request.formData()`.
 */
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
