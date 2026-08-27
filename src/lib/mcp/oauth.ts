/**
 * Verificación OAuth 2.1 (ADR-023): getUser contra GoTrue (autoritativo) +
 * claim client_id en allowlist — un token de sesión web NO abre el conector.
 * Caché por SHA-256 del token (jamás en claro); revocar tarda hasta TTL_MS.
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

/** `undefined` → withMcpAuth responde 401 CON WWW-Authenticate (sin él, los clientes no descubren el auth server). */
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
