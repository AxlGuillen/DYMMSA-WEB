/**
 * Helpers de route handlers: auth y respuestas estándar.
 * Uso: `const auth = await requireAuth(supabase); if ('error' in auth) return auth.error`
 */

import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

// ─── Auth ──────────────────────────────────────────────────────────────

/** Retorna { user } o { error } con el 401 listo — errores como valores, sin excepciones. */
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
