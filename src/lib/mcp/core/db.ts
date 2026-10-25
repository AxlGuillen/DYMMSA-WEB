/**
 * Tools take Db as a parameter (mockable); in production it is per-request from the OAuth
 * token so RLS applies — zero service_role (ADR-023; health is the exception, it uses admin).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Db = SupabaseClient
