// MCP endpoint at /api/mcp (ADR-023), Supabase OAuth via withMcpAuth.
// No requiredScopes: Supabase tokens carry no scope claim (it would 403).

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { registerDymmsaTools, SERVER_INSTRUCTIONS } from '@/lib/mcp/server'
import { verifyToken } from '@/lib/mcp/oauth'
import { appUrl } from '@/lib/mcp/env'
import { PROTECTED_RESOURCE_PATH } from '@/lib/mcp/routes'

// nodejs, never edge: node:crypto (token fingerprint) does not run on edge.
export const runtime = 'nodejs'
// Literal on purpose: Next reads segment configs statically and an imported constant
// breaks it. Must match the createMcpHandler maxDuration below.
export const maxDuration = 60

const handler = createMcpHandler(
  registerDymmsaTools,
  {
    serverInfo: { name: 'dymmsa', version: '2.0.0' },
    // Block map (app vs Odoo, #72) + business rules as server instructions, so clients
    // that never read resources still get them.
    instructions: SERVER_INSTRUCTIONS,
  },
  {
    basePath: '/api',
    disableSse: true,
    maxDuration: 60,
  },
)

const authedHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: PROTECTED_RESOURCE_PATH,
  resourceUrl: appUrl(),
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
