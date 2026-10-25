import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { contextFrom, type McpContext } from './context'
import type { Db } from './db'
import { toToolResult } from './errors'
import { toolResultOf, type ToolResult } from './result'

/** The SDK hands the AuthInfo validated by withMcpAuth in each call's extra. */
type ToolExtra = { authInfo?: AuthInfo }

/** Runs the tool with the token's db (RLS applies); expected errors surface their message, the rest go generic.
 *  The context carries the caller's identity for tools that mean "me" (hours, #101). */
export async function run(tool: string, extra: ToolExtra, fn: (db: Db, ctx: McpContext) => Promise<unknown>): Promise<ToolResult> {
  const startedAt = Date.now()
  try {
    const ctx = contextFrom(extra.authInfo)
    // Only a withResultMeta() result fills _meta: the view reads it, the text never carries it (#144).
    return toolResultOf(await fn(ctx.db, ctx))
  } catch (e) {
    return toToolResult(e, tool, startedAt)
  }
}
