/**
 * Clientes Supabase REALES contra el stack local (Fase C1). Se inyectan en los
 * route handlers vía el mismo seam que los mocks (`injectSupabaseServer` /
 * `injectSupabaseAdmin`): en vez de un mock devuelven un cliente auténtico, así
 * el handler ejerce auth + RLS + SQL de verdad.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { LOCAL } from './db'

let authed: SupabaseClient | null = null

/**
 * Cliente autenticado como el usuario de prueba (test@dymmsa.local). Cacheado:
 * la sesión (JWT del rol `authenticated`) se reusa entre tests — RLS lo ve como
 * usuario logueado, igual que en la app. `requireAuth` → getUser() devuelve el user.
 */
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

/** Cliente service-role (bypassa RLS) — para la ruta pública /approve/[token]. */
export function serviceClient(): SupabaseClient {
  return createClient(LOCAL.url, LOCAL.service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
