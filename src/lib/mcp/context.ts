/** Per-call context (ADR-023): builds the tool's Db from the request token. */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

import type { McpIdentity } from './oauth'
import type { McpRole } from './manifest'
import { clientForToken } from './supabase'
import { ToolError, type Db } from './shared'

export type McpContext = McpIdentity & { db: Db }

/** Which handler serves the request (#133). Anything but a verified admin gets the member list. */
export function roleFrom(authInfo: AuthInfo | undefined): McpRole {
  return (authInfo?.extra as Partial<McpIdentity> | undefined)?.role === 'admin' ? 'admin' : 'member'
}

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
