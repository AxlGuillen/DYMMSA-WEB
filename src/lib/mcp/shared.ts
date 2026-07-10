/**
 * Tipos y errores compartidos del módulo MCP.
 *
 * Los tools reciben el cliente Supabase como parámetro (inyección) para ser
 * testeables con el mock de `tests/helpers/supabase-mock.ts`, igual que los
 * route handlers. En producción siempre es el admin client (service role):
 * la autenticación del MCP es su propia capa (token compartido, ver auth.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Db = SupabaseClient

/**
 * Error esperado de un tool (no encontrado, entrada inválida, fallo de BD
 * con contexto). Su `message` se devuelve al cliente MCP tal cual; cualquier
 * otro error se loguea y se responde con un mensaje genérico.
 */
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
