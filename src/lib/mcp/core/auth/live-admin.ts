import { ADMIN_ONLY_MESSAGE, issueAdminProof, type AdminProof } from '@/lib/odoo/write-guard'
import type { McpContext } from '../context'
import type { Db } from '../db'
import { ToolError } from '../errors'

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
