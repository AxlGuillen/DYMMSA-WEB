/**
 * Verificación de tokens OAuth 2.1 del MCP remoto (ADR-023).
 *
 * Dos puertas, en orden:
 *   1. `getUser(token)` contra GoTrue — autoritativo: detecta revocación y
 *      expiración, no solo firma.
 *   2. El token debe traer claim `client_id` (solo los emitidos por el flujo
 *      OAuth lo llevan — un token de sesión web normal NO abre el conector) y,
 *      si hay allowlist (`MCP_OAUTH_CLIENT_IDS`), estar en ella.
 *
 * NO hay puerta de tenant: dymmsa es una sola empresa con proyecto Supabase
 * propio (sin signup público, usuarios sembrados a mano) — ser usuario del
 * proyecto ES ser staff. Si algún día el proyecto se comparte o aparece
 * multi-tenancy, esta es la puerta que hay que agregar (ver admin-home).
 *
 * La caché de identidad amortiza el round trip a GoTrue (una pregunta del LLM
 * encadena varias tools). Clave = SHA-256 del token — nunca el token en claro
 * (un heap dump o log lo expondría) y por construcción una entrada jamás puede
 * servirle a otro token. El precio: revocar tarda hasta TTL_MS en surtir efecto.
 */

import { createHash } from 'node:crypto'

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

import { allowedClientIds } from './env'
import { verifierClient } from './supabase'

export type McpIdentity = {
  userId: string
  email: string | null
  clientId: string
}

type CachedIdentity = McpIdentity & { expiresAt: number }

const TTL_MS = 60_000
const MAX_ENTRIES = 16

const cache = new Map<string, { at: number; identity: Promise<CachedIdentity | null> }>()

function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

/** Solo seguro DESPUÉS de que getUser probó que el token es genuino. */
function claims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  if (!payload) return {}
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return {}
  }
}

// Un 401 sin motivo es un fallo silencioso. Se registra en qué puerta se cayó,
// nunca el token. Solo va a los logs del server.
function reject(reason: string, detail?: Record<string, unknown>): null {
  console.warn('[mcp] token rechazado:', reason, detail ?? '')
  return null
}

async function identify(token: string): Promise<CachedIdentity | null> {
  const { data, error } = await verifierClient().auth.getUser(token)
  if (error || !data.user) {
    return reject('getUser falló', { error: error?.message })
  }

  const payload = claims(token)
  const clientId = typeof payload.client_id === 'string' ? payload.client_id : ''

  if (!clientId) return reject('el token no trae client_id (sesión web, no conector)')

  const allowed = allowedClientIds()
  if (allowed.length && !allowed.includes(clientId)) {
    return reject('client_id fuera del allowlist', { tokenClientId: clientId })
  }

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    clientId,
    expiresAt: typeof payload.exp === 'number' ? payload.exp : 0,
  }
}

function identityFor(token: string): Promise<CachedIdentity | null> {
  const key = fingerprint(token)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.identity

  const pending = identify(token)
  cache.set(key, { at: Date.now(), identity: pending })
  // No cachear errores: un fallo transitorio de red no debe pegarse 60s.
  pending.catch(() => {
    if (cache.get(key)?.identity === pending) cache.delete(key)
  })

  for (const stale of cache.keys()) {
    if (cache.size <= MAX_ENTRIES) break
    cache.delete(stale)
  }
  return pending
}

/**
 * Devolver `undefined` es lo que hace que `withMcpAuth` conteste 401 con el
 * header `WWW-Authenticate` apuntando al metadata del recurso. Sin ese header
 * ningún cliente MCP puede descubrir el authorization server.
 */
export async function verifyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined

  const identity = await identityFor(bearerToken)
  if (!identity) return undefined

  const { expiresAt, ...rest } = identity

  return {
    token: bearerToken,
    clientId: identity.clientId,
    // Los access tokens de Supabase no llevan claim `scope` → exigir scopes
    // daría 403 siempre. Y sin validación de audiencia RFC 8707 (Supabase emite
    // aud: "authenticated"), afirmar `resource` aquí sería mentir.
    scopes: [],
    expiresAt,
    extra: { ...rest } satisfies McpIdentity,
  }
}

/** Solo para los tests: la caché vive en el módulo y se filtraría entre casos. */
export function resetIdentityCache(): void {
  cache.clear()
}
