/** Per-call context (ADR-023): builds the tool's Db from the request token. */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

import type { McpIdentity } from './oauth'
import { clientForToken } from './supabase'
import { ToolError, type Db } from './shared'

export type McpContext = McpIdentity & { db: Db }

export function contextFrom(authInfo: AuthInfo | undefined): McpContext {
  // Unreachable with withMcpAuth({ required: true }); the message targets the connector user.
  if (!authInfo) {
    throw new ToolError('Sin sesión. Vuelve a conectar el conector.')
  }

  const identity = authInfo.extra as McpIdentity | undefined
  if (!identity?.userId) {
    throw new ToolError('Sesión incompleta. Vuelve a conectar el conector.')
  }

  return { ...identity, db: clientForToken(authInfo.token) }
}
