/**
 * OAuth 2.1 check (ADR-023): getUser + client_id allowlist — a web session token can't open the connector.
 * Cache keyed by the token's SHA-256 (never plaintext); revocation lags up to TTL_MS.
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

/** Only safe AFTER getUser proved the token is genuine. */
function claims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  if (!payload) return {}
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return {}
  }
}

// A 401 with no reason is a silent failure: log which gate rejected, never the token.
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
  // Don't cache failures: a transient network error must not stick for 60s.
  pending.catch(() => {
    if (cache.get(key)?.identity === pending) cache.delete(key)
  })

  for (const stale of cache.keys()) {
    if (cache.size <= MAX_ENTRIES) break
    cache.delete(stale)
  }
  return pending
}

/** `undefined` → withMcpAuth answers 401 WITH WWW-Authenticate; without it clients can't discover the auth server. */
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
    // Supabase tokens carry no `scope` claim (requiring scopes would always 403), and
    // without RFC 8707 audience validation asserting `resource` here would be a lie.
    scopes: [],
    expiresAt,
    extra: { ...rest } satisfies McpIdentity,
  }
}

/** Tests only: the module-level cache would leak between cases. */
export function resetIdentityCache(): void {
  cache.clear()
}
