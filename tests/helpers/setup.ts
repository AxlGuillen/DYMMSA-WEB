/**
 * Inyección del mock de Supabase en route handlers (DRY del beforeEach).
 *
 * IMPORTANTE: el archivo de test DEBE conservar a nivel de módulo
 *   vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
 * (y/o el de admin) porque `vi.mock` se hoista en tiempo de compilación y no
 * puede vivir dentro de un helper. Estas funciones solo registran el
 * `beforeEach` que conecta tu cliente activo con la implementación mockeada.
 *
 * Uso:
 *   vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
 *   let activeClient: MockSupabaseClient
 *   injectSupabaseServer(() => activeClient)
 *   // ...luego en cada test: activeClient = createMockSupabase({...})
 */

import { beforeEach, vi } from 'vitest'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MockSupabaseClient } from './supabase-mock'

/** Conecta createClient() (server) con el cliente devuelto por getClient() en cada test. */
export function injectSupabaseServer(getClient: () => MockSupabaseClient) {
  beforeEach(() => {
    vi.mocked(createClient).mockImplementation(async () => getClient() as never)
  })
}

/** Conecta createAdminClient() (ruta pública /approve) con getClient() en cada test. */
export function injectSupabaseAdmin(getClient: () => MockSupabaseClient) {
  beforeEach(() => {
    vi.mocked(createAdminClient).mockImplementation(() => getClient() as never)
  })
}
