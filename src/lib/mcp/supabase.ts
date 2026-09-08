/**
 * MCP Supabase clients (ADR-023), ZERO service_role: RLS is the only barrier.
 * verifierClient is separate because supabase-js disables client.auth when accessToken is set.
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

/** Tests only: the singleton would leak across cases with different mocks. */
export function resetVerifierClient(): void {
  verifier = null
}
