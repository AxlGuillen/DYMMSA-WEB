/**
 * Tools take Db as a parameter (mockable); in production it is per-request from the OAuth
 * token so RLS applies — zero service_role (ADR-023; health is the exception, it uses admin).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Db = SupabaseClient

/** Expected tool error: its message reaches the client verbatim; anything else is logged and genericized. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

/** 1-indexed page, capped size — same limits as the API routes. */
export function normalizePagination(input: { page?: number; pageSize?: number }, defaultSize = 20) {
  const page = Math.max(1, Math.floor(input.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? defaultSize)))
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 }
}

/** Strips characters that break PostgREST's `.or()` filter syntax. */
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%]/g, ' ').trim()
}
