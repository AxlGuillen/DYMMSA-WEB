/**
 * Clientes Supabase del MCP (ADR-023), CERO service_role: clientForToken actúa
 * como el usuario del token (RLS es la única barrera). verifierClient existe
 * aparte porque con accessToken supabase-js bloquea client.auth.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const AUTH_OFF = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const

export function clientForToken(accessToken: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: AUTH_OFF, accessToken: async () => accessToken },
  )
}

let verifier: SupabaseClient | null = null

export function verifierClient(): SupabaseClient {
  verifier ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: AUTH_OFF },
  )
  return verifier
}

/** Solo para tests: el singleton viviría entre casos con mocks distintos. */
export function resetVerifierClient(): void {
  verifier = null
}
