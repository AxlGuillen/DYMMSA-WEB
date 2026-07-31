/**
 * Clientes Supabase del MCP remoto (ADR-023). CERO service_role.
 *
 * `clientForToken` construye un cliente por request que actúa COMO el usuario
 * del token: la opción `accessToken` hace que PostgREST reciba ese JWT y RLS
 * aplique exactamente igual que en la app. Ninguna query filtra a mano — RLS
 * es la única barrera de datos.
 *
 * supabase-js reemplaza `client.auth` por un proxy que lanza cuando se pasa
 * `accessToken` (así este cliente no puede iniciar/cerrar sesión por
 * accidente); por eso existe `verifierClient`, un cliente aparte y compartido
 * (stateless) cuyo único trabajo es `auth.getUser(token)` contra GoTrue.
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
