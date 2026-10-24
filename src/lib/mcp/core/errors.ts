import { DomainError } from '@/lib/domain-error'
import { GitHubError } from '@/lib/github'
import { OdooError } from '@/lib/odoo/client'
import type { ToolResult } from './result'

/** Expected tool error: its message reaches the client verbatim; anything else is logged and genericized. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

/** The one error mapping of the MCP (#155 C1): a store's DomainError needs no per-tool translator. */
export function toToolResult(error: unknown, tool: string, startedAt: number): ToolResult {
  if (error instanceof ToolError || error instanceof DomainError || error instanceof GitHubError || error instanceof OdooError) {
    return { content: [{ type: 'text', text: error.message }], isError: true }
  }
  console.error(`[mcp] ${tool} falló tras ${Date.now() - startedAt} ms:`, error)
  return { content: [{ type: 'text', text: `Error interno en ${tool}` }], isError: true }
}
