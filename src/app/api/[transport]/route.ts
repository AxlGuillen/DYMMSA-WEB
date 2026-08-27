/**
 * Endpoint MCP en /api/mcp (ADR-023), OAuth de Supabase vía withMcpAuth.
 * Sin requiredScopes: los tokens de Supabase no traen claim scope (daría 403).
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { registerDymmsaTools, SERVER_INSTRUCTIONS } from '@/lib/mcp/server'
import { verifyToken } from '@/lib/mcp/oauth'
import { appUrl } from '@/lib/mcp/env'
import { PROTECTED_RESOURCE_PATH } from '@/lib/mcp/routes'

// nodejs, nunca edge: node:crypto (fingerprint del token) no corre en edge.
export const runtime = 'nodejs'
// Literal a la fuerza: Next analiza los config de segmento estáticamente y una
// constante importada lo rompe con "Invalid segment configuration export".
// Debe coincidir con el maxDuration de createMcpHandler de abajo.
export const maxDuration = 60

const handler = createMcpHandler(
  registerDymmsaTools,
  {
    serverInfo: { name: 'dymmsa', version: '2.0.0' },
    // Mapa de los dos bloques (app vs Odoo, issue #72) + reglas de negocio.
    // Viajan como instrucciones del server (además del resource
    // dymmsa://reglas-negocio): clientes que no leen resources las reciben igual.
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
