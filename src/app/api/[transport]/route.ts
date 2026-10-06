// MCP endpoint at /api/mcp (ADR-023), Supabase OAuth via withMcpAuth.
// No requiredScopes: Supabase tokens carry no scope claim (it would 403).

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { registerDymmsaTools, serverInstructions } from '@/lib/mcp/server'
import { roleFrom } from '@/lib/mcp/context'
import type { McpRole } from '@/lib/mcp/manifest'
import { verifyToken } from '@/lib/mcp/oauth'
import { appUrl } from '@/lib/mcp/env'
import { PROTECTED_RESOURCE_PATH } from '@/lib/mcp/routes'

// nodejs, never edge: node:crypto (token fingerprint) does not run on edge.
export const runtime = 'nodejs'
// Literal on purpose: Next reads segment configs statically and an imported constant
// breaks it. Must match the createMcpHandler maxDuration below.
export const maxDuration = 60

// One handler per role (#133): a member's tools/list never carries the admin-only tools.
// Trimming the list is noise reduction; the RLS behind every tool is still the barrier.
function handlerFor(role: McpRole) {
  return createMcpHandler(
    (server) => registerDymmsaTools(server, role),
    {
      serverInfo: { name: 'dymmsa', version: '2.1.0' },
      // Block map (app vs Odoo, #72) + business rules as server instructions, so clients
      // that never read resources still get them.
      instructions: serverInstructions(role),
    },
    {
      basePath: '/api',
      disableSse: true,
      maxDuration: 60,
    },
  )
}

const handlers: Record<McpRole, ReturnType<typeof handlerFor>> = {
  admin: handlerFor('admin'),
  member: handlerFor('member'),
}

// withMcpAuth hangs the verified AuthInfo on req.auth (same instance) before calling us; typed
// here on purpose so a package change shows up as a type error, not as every admin going member.
const handler = (req: Request & { auth?: AuthInfo }) => handlers[roleFrom(req.auth)](req)

const authedHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: PROTECTED_RESOURCE_PATH,
  resourceUrl: appUrl(),
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
