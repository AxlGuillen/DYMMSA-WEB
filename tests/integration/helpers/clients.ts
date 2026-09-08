/**
 * Real Supabase clients against the local stack, injected through the same seam
 * as the mocks so handlers exercise real auth, RLS and SQL.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { LOCAL } from './db'

let authed: SupabaseClient | null = null

/** Test-user client, cached: the session is reused so RLS sees a logged-in user, as in the app. */
export async function authedClient(): Promise<SupabaseClient> {
  if (authed) return authed
  const client = createClient(LOCAL.url, LOCAL.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword(LOCAL.user)
  if (error) throw new Error(`No se pudo autenticar el usuario de prueba: ${error.message}`)
  authed = client
  return client
}

/** Service-role client (bypasses RLS) for the public /approve/[token] route. */
export function serviceClient(): SupabaseClient {
  return createClient(LOCAL.url, LOCAL.service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
