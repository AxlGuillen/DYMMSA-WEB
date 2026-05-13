/**
 * Helpers para route handlers de Next.js: auth y respuestas estándar.
 *
 * Patrón de uso:
 *
 * ```ts
 * const supabase = await createClient()
 * const auth = await requireAuth(supabase)
 * if ('error' in auth) return auth.error
 * const { user } = auth
 * ```
 *
 * Esto reemplaza el patrón duplicado en 9+ routes:
 *
 * ```ts
 * const { data: { user } } = await supabase.auth.getUser()
 * if (!user) return NextResponse.json({ message: 'No autorizado' }, { status: 401 })
 * ```
 */

import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

// ─── Auth ──────────────────────────────────────────────────────────────

/**
 * Verifica autenticación. Retorna `{ user }` si está autenticado,
 * o `{ error }` con un NextResponse 401 listo para devolver.
 *
 * Diseñado para no lanzar excepciones — los errores son valores.
 */
export async function requireAuth(
  supabase: SupabaseServerClient
): Promise<{ user: User } | { error: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: unauthorized() }
  return { user }
}

// ─── Respuestas estándar ───────────────────────────────────────────────

export const unauthorized = (msg = 'No autorizado') =>
  NextResponse.json({ message: msg }, { status: 401 })

export const notFound = (msg = 'No encontrado') =>
  NextResponse.json({ message: msg }, { status: 404 })

export const badRequest = (msg: string) =>
  NextResponse.json({ message: msg }, { status: 400 })

export const forbidden = (msg = 'Acción no permitida') =>
  NextResponse.json({ message: msg }, { status: 403 })

export const serverError = (msg = 'Error interno') =>
  NextResponse.json({ message: msg }, { status: 500 })
