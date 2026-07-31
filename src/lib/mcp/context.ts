/**
 * Contexto por llamada de tool (ADR-023): resuelve QUÉ cliente Supabase usa la
 * tool a partir del AuthInfo que el SDK entrega en el `extra` de cada handler.
 * Los tools no cambian de firma — siguen recibiendo `Db` — solo cambia quién
 * lo construye: antes un admin client global, ahora el token del request.
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

import type { McpIdentity } from './oauth'
import { clientForToken } from './supabase'
import { ToolError, type Db } from './shared'

export type McpContext = McpIdentity & { db: Db }

export function contextFrom(authInfo: AuthInfo | undefined): McpContext {
  // Con withMcpAuth({ required: true }) esto no debería pasar; si pasa, el
  // mensaje le dice al usuario del conector qué hacer, no un "error interno".
  if (!authInfo) {
    throw new ToolError('Sin sesión. Vuelve a conectar el conector.')
  }

  const identity = authInfo.extra as McpIdentity | undefined
  if (!identity?.userId) {
    throw new ToolError('Sesión incompleta. Vuelve a conectar el conector.')
  }

  return { ...identity, db: clientForToken(authInfo.token) }
}
