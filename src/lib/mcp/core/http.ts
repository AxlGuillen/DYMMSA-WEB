/** The HTTP side of a connector (ADR-023, #155 B1): one route per connector, same OAuth, same role split. */

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { McpRole } from '../manifest'
import { verifyToken } from './auth/oauth'
import { roleFrom } from './context'
import { connectorPath, type ConnectorDefinition } from './define'
import { appUrl } from './env'
import { registerTools } from './register'
import { protectedResourcePath } from './routes'

/** Every route file must export this same number as its literal `maxDuration` (Next reads it statically). */
export const MCP_MAX_DURATION_S = 60

/** No requiredScopes: Supabase tokens carry no scope claim (it would 403). */
export function connectorRoute(connector: ConnectorDefinition) {
  // One handler per role (#133): a member's tools/list never carries the admin-only tools.
  // Trimming the list is noise reduction; the RLS behind every tool is still the barrier.
  const handlerFor = (role: McpRole) =>
    createMcpHandler(
      (server) => registerTools(server, connector.tools, role),
      // Instructions too, so clients that never read resources still get the map and the rules.
      { serverInfo: connector.serverInfo, instructions: connector.instructions(role) },
      { basePath: connector.basePath, disableSse: true, maxDuration: MCP_MAX_DURATION_S },
    )
  const handlers: Record<McpRole, ReturnType<typeof handlerFor>> = { admin: handlerFor('admin'), member: handlerFor('member') }

  // withMcpAuth hangs the verified AuthInfo on req.auth before calling us; with `required: true` a
  // missing auth is unreachable, so if it ever happens it is logged instead of silently going member.
  const handler = (req: Request & { auth?: AuthInfo }) => {
    if (!req.auth) console.warn(`[mcp:${connector.id}] request sin AuthInfo tras withMcpAuth; se sirve la lista de member`)
    return handlers[roleFrom(req.auth)](req)
  }

  // resourceUrl is the ORIGIN: mcp-handler appends the metadata path to build resource_metadata.
  return withMcpAuth(handler, verifyToken, {
    required: true,
    resourceMetadataPath: protectedResourcePath(connectorPath(connector)),
    resourceUrl: appUrl(),
  })
}
