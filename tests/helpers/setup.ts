/**
 * Supabase mock injection. The test file MUST keep its own module-level
 * `vi.mock('@/lib/supabase/server', ...)`: vi.mock is hoisted and can't live in a helper.
 */

import { beforeEach, vi } from 'vitest'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MockSupabaseClient } from './supabase-mock'

/** Wires createClient() (server) to getClient() on every test. */
export function injectSupabaseServer(getClient: () => MockSupabaseClient) {
  beforeEach(() => {
    vi.mocked(createClient).mockImplementation(async () => getClient() as never)
  })
}

/** Wires createAdminClient() (public /approve route) to getClient() on every test. */
export function injectSupabaseAdmin(getClient: () => MockSupabaseClient) {
  beforeEach(() => {
    vi.mocked(createAdminClient).mockImplementation(() => getClient() as never)
  })
}
