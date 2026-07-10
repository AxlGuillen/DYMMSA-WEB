/**
 * Endpoint MCP — POST /api/mcp (Streamable HTTP, sin SSE → no requiere Redis).
 *
 * El segmento dinámico [transport] lo exige mcp-handler; con basePath '/api'
 * solo atiende /api/mcp (cualquier otro valor responde 404). Las rutas API
 * estáticas existentes siempre ganan sobre este segmento dinámico.
 *
 * Auth: Bearer token compartido (MCP_API_KEY) — ver src/lib/mcp/auth.ts.
 */

import { createMcpHandler } from 'mcp-handler'
import { registerDymmsaTools } from '@/lib/mcp/server'
import { requireMcpAuth } from '@/lib/mcp/auth'

const handler = createMcpHandler(
  registerDymmsaTools,
  {
    serverInfo: { name: 'dymmsa', version: '1.0.0' },
  },
  {
    basePath: '/api',
    disableSse: true,
    maxDuration: 60,
  },
)

const authedHandler = requireMcpAuth(handler)

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
