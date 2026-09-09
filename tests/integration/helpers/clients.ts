/**
 * Real Supabase clients against the local stack, injected through the same seam
 * as the mocks so handlers exercise real auth, RLS and SQL.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { LOCAL } from './db'

type Credentials = { email: string; password: string }

const cache = new Map<string, SupabaseClient>()

/** Authenticated client per seeded user, cached so RLS sees a logged-in session, as in the app. */
export async function authedClientAs(creds: Credentials): Promise<SupabaseClient> {
  const hit = cache.get(creds.email)
  if (hit) return hit
  const client = createClient(LOCAL.url, LOCAL.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword(creds)
  if (error) throw new Error(`No se pudo autenticar ${creds.email}: ${error.message}`)
  cache.set(creds.email, client)
  return client
}

/** The default test user (admin since #93; admin ⊇ member keeps older tests valid). */
export function authedClient(): Promise<SupabaseClient> {
  return authedClientAs(LOCAL.user)
}

/** Service-role client (bypasses RLS) for the public /approve/[token] route. */
export function serviceClient(): SupabaseClient {
  return createClient(LOCAL.url, LOCAL.service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
