/**
 * Tools take Db as a parameter (mockable); in production it is per-request from the OAuth
 * token so RLS applies — zero service_role (ADR-023; health is the exception, it uses admin).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { ADMIN_ONLY_MESSAGE, issueAdminProof, type AdminProof } from '@/lib/odoo/write-guard'
import type { McpContext } from './context'

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Tools accept "a UUID or a name": this decides which lookup runs. */
export const isUuid = (value: string) => UUID_RE.test(value)

/** Accent- and case-insensitive name matching for the name lookups. */
export const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Exactly one match or a ToolError that lists the candidates — the guard every name lookup shares (#109). */
export function requireSingleMatch<T>(matches: T[], label: (m: T) => string, what: string, query: string): T {
  if (matches.length === 0) throw new ToolError(`No hay ${what} que coincida con "${query}".`)
  if (matches.length > 1) {
    const shown = matches.slice(0, 5).map(label).join(', ')
    const count = matches.length > 5 ? 'más de 5' : String(matches.length)
    throw new ToolError(`Hay ${count} coincidencias (${shown}${matches.length > 5 ? ', …' : ''}) — precisa el nombre.`)
  }
  return matches[0]
}

/** The caller's role read now with their own token (each profile row is visible to its owner). */
export async function isAdminNow(db: Db, userId: string): Promise<boolean> {
  const { data } = await db.from('profiles').select('role').eq('id', userId).single()
  return (data as { role?: string } | null)?.role === 'admin'
}

/**
 * Odoo writes trust the role as it is NOW, not the token's 60 s cache (#144, ADR-040).
 * The only caller of issueAdminProof: every writer operation demands the proof it returns.
 */
export async function requireLiveAdmin(ctx: Pick<McpContext, 'db' | 'userId' | 'role'>): Promise<AdminProof> {
  // The token's role first: a member never even reaches the profiles read.
  if (ctx.role !== 'admin' || !ctx.userId) throw new ToolError(ADMIN_ONLY_MESSAGE)
  const row = await liveProfile(ctx.db, ctx.userId)
  const displayName = typeof row?.display_name === 'string' ? row.display_name.trim() : ''
  if (row?.role !== 'admin' || !displayName) throw new ToolError(ADMIN_ONLY_MESSAGE)
  return issueAdminProof({ userId: ctx.userId, displayName })
}

/** Bounded: it runs inside PRE_TOOL_HEADROOM_MS (odoo/deadline.ts), before the tool's own clock. */
export const LIVE_ADMIN_READ_TIMEOUT_MS = 3_000

/** Any failure reads as "not an admin": an unreadable role never opens a write. */
async function liveProfile(db: Db, userId: string): Promise<{ role?: unknown; display_name?: unknown } | null> {
  try {
    const { data, error } = await db
      .from('profiles')
      .select('role, display_name')
      .eq('id', userId)
      .abortSignal(AbortSignal.timeout(LIVE_ADMIN_READ_TIMEOUT_MS))
      .maybeSingle()
    if (!error) return data as { role?: unknown; display_name?: unknown } | null
    console.warn('[mcp] no se pudo releer el rol para escribir en Odoo:', error.message)
  } catch {
    console.warn('[mcp] no se pudo releer el rol para escribir en Odoo')
  }
  return null
}

/** Keys a view reads from a result's _meta; namespaced so they never collide with the protocol's. */
export type ResultMeta = Readonly<Record<`dymmsa/${string}`, string>>

declare const resultDataType: unique symbol

/** Opaque wrapper: only run() opens it, so its meta never lands in the text the model reads (#144). */
export interface ResultWithMeta<T> {
  readonly [resultDataType]?: T
  toJSON(): never
}

// Identity, not shape: an Odoo row that happens to carry `_meta` stays plain data.
const resultMeta = new WeakMap<object, { data: unknown; meta: ResultMeta }>()

export function withResultMeta<T>(data: T, meta: ResultMeta): ResultWithMeta<T> {
  const wrapper: ResultWithMeta<T> = Object.freeze({
    // Nested in other data it would be serialized: failing beats leaking or dropping the meta.
    toJSON(): never {
      throw new Error('withResultMeta() must be the tool result itself, never nested in other data')
    },
  })
  resultMeta.set(wrapper, { data, meta: Object.freeze({ ...meta }) })
  return wrapper
}

/** The tool's data and, only for a withResultMeta() result with keys, its meta. */
export function splitResultMeta<T>(value: T | ResultWithMeta<T>): { data: T; meta: ResultMeta | null } {
  const entry = typeof value === 'object' && value !== null ? resultMeta.get(value) : undefined
  if (!entry) return { data: value as T, meta: null }
  return { data: entry.data as T, meta: Object.keys(entry.meta).length > 0 ? entry.meta : null }
}
