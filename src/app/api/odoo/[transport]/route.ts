// «Odoo DYMMSA» MCP endpoint at /api/odoo/mcp (#155 B1, ADR-041); same OAuth and allowlist as /api/mcp.

import { connectorRoute } from '@/lib/mcp/core/http'
import { odooConnector } from '@/lib/mcp/connectors/odoo/connector'

// nodejs, never edge: node:crypto (token fingerprint) does not run on edge.
export const runtime = 'nodejs'
// Literal on purpose: Next reads segment configs statically. Must equal MCP_MAX_DURATION_S.
export const maxDuration = 60

const handler = connectorRoute(odooConnector)

export { handler as GET, handler as POST, handler as DELETE }
