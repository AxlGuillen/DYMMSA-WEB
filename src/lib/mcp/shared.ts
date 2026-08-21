/**
 * Tipos/errores compartidos del MCP. Los tools reciben el Db por parámetro
 * (testeables con mock); en producción es por-request desde el token OAuth —
 * RLS aplica, cero service_role (ADR-023; health es la excepción con admin).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Db = SupabaseClient

/** Error esperado de tool: su message va al cliente tal cual; el resto se loguea y sale genérico. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

/** Página 1-indexada y tamaño acotado, mismos límites que las rutas API. */
export function normalizePagination(input: { page?: number; pageSize?: number }, defaultSize = 20) {
  const page = Math.max(1, Math.floor(input.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? defaultSize)))
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 }
}

/** Quita los caracteres que rompen la sintaxis del filtro `.or()` de PostgREST. */
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%]/g, ' ').trim()
}
