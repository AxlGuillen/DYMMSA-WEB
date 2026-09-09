/** Route handler helpers. Use: `const auth = await requireAuth(supabase); if ('error' in auth) return auth.error` */

import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import type { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** Returns { user } or { error } with the 401 ready — errors as values, not exceptions. */
export async function requireAuth(
  supabase: SupabaseServerClient
): Promise<{ user: User } | { error: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: unauthorized() }
  return { user }
}

export type CallerProfile = Pick<Profile, 'id' | 'role' | 'display_name'>

/** requireAuth plus the caller's profile (null if missing), for handlers that branch on role. */
export async function requireRole(
  supabase: SupabaseServerClient
): Promise<{ user: User; profile: CallerProfile | null } | { error: NextResponse }> {
  const auth = await requireAuth(supabase)
  if ('error' in auth) return auth
  const { data } = await supabase
    .from('profiles')
    .select('id, role, display_name')
    .eq('id', auth.user.id)
    .single()
  return { user: auth.user, profile: (data as CallerProfile | null) ?? null }
}

/**
 * Members get a 403. Pairs with RLS + is_admin() in the database — never a
 * replacement for them (ADR-026).
 */
export async function requireAdmin(
  supabase: SupabaseServerClient
): Promise<{ user: User; profile: CallerProfile } | { error: NextResponse }> {
  const auth = await requireRole(supabase)
  if ('error' in auth) return auth
  if (auth.profile?.role !== 'admin') return { error: forbidden() }
  return { user: auth.user, profile: auth.profile }
}

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
