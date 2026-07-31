/**
 * Endpoint MCP remoto (ADR-023): Streamable HTTP en /api/mcp, protegido con
 * OAuth 2.1 nativo de Supabase vía withMcpAuth.
 *
 * - `basePath: '/api'` + el segmento [transport] derivan /api/mcp. Las rutas
 *   API estáticas existentes siempre ganan sobre este segmento dinámico.
 * - `disableSse` → no requiere Redis.
 * - `resourceUrl` es el ORIGEN, no la URI del recurso: withMcpAuth concatena
 *   `${resourceUrl}${resourceMetadataPath}` para el header WWW-Authenticate.
 * - Sin `requiredScopes`: los access tokens de Supabase no traen claim `scope`;
 *   exigir cualquiera daría 403 en todas las requests.
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { registerDymmsaTools, BUSINESS_RULES_MD } from '@/lib/mcp/server'
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
    // Las reglas de negocio viajan también como instrucciones del server (además
    // del resource dymmsa://reglas-negocio): clientes que no leen resources las
    // reciben igual.
    instructions: BUSINESS_RULES_MD,
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
