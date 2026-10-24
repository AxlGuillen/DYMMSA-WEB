// «DYMMSA-WEB» MCP endpoint at /api/mcp (ADR-023, #155 ADR-041); the wiring lives in core/http.ts.

import { connectorRoute } from '@/lib/mcp/core/http'
import { dymmsaConnector } from '@/lib/mcp/connectors/dymmsa/connector'

// nodejs, never edge: node:crypto (token fingerprint) does not run on edge.
export const runtime = 'nodejs'
// Literal on purpose: Next reads segment configs statically. Must equal MCP_MAX_DURATION_S.
export const maxDuration = 60

const handler = connectorRoute(dymmsaConnector)

export { handler as GET, handler as POST, handler as DELETE }
