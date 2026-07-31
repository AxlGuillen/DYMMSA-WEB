/**
 * verifyToken del MCP remoto (ADR-023) — las puertas y la caché de identidad.
 *
 * GoTrue se mockea a nivel módulo (vi.mock de ./supabase). Los "tokens" son
 * JWTs sintéticos (header.payload.firma en base64url) — verifyToken solo lee
 * claims DESPUÉS de que getUser (mockeado) los avala, igual que en producción.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/mcp/supabase', () => ({
  verifierClient: vi.fn(),
  clientForToken: vi.fn(),
}))

import { verifierClient } from '@/lib/mcp/supabase'
import { verifyToken, resetIdentityCache } from '@/lib/mcp/oauth'

const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')

/** JWT sintético con los claims dados (la firma no se valida aquí — GoTrue lo hace). */
function makeToken(claims: Record<string, unknown>): string {
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.firma`
}

const getUser = vi.fn()

function mockGoTrue(user: { id: string; email?: string } | null, error: string | null = null) {
  getUser.mockResolvedValue(
    error ? { data: { user: null }, error: { message: error } } : { data: { user }, error: null },
  )
}

beforeEach(() => {
  resetIdentityCache()
  getUser.mockReset()
  vi.mocked(verifierClient).mockReturnValue({
    auth: { getUser },
  } as unknown as ReturnType<typeof verifierClient>)
  delete process.env.MCP_OAUTH_CLIENT_IDS
})

afterEach(() => {
  vi.useRealTimers()
})

const req = new Request('http://localhost/api/mcp')

describe('verifyToken — puertas', () => {
  test('sin bearer → undefined (dispara el 401 con resource_metadata)', async () => {
    expect(await verifyToken(req, undefined)).toBeUndefined()
    expect(getUser).not.toHaveBeenCalled()
  })

  test('getUser falla (token inválido/revocado) → undefined', async () => {
    mockGoTrue(null, 'invalid token')
    expect(await verifyToken(req, makeToken({ client_id: 'c1' }))).toBeUndefined()
  })

  test('REGLA: token de sesión web (sin client_id) NO abre el conector', async () => {
    mockGoTrue({ id: 'u1', email: 'a@dymmsa.com' })
    expect(await verifyToken(req, makeToken({ exp: 999 }))).toBeUndefined()
  })

  test('client_id fuera del allowlist → undefined', async () => {
    process.env.MCP_OAUTH_CLIENT_IDS = 'permitido-1, permitido-2'
    mockGoTrue({ id: 'u1' })
    expect(await verifyToken(req, makeToken({ client_id: 'intruso' }))).toBeUndefined()
  })

  test('allowlist vacío → acepta cualquier cliente del proyecto', async () => {
    mockGoTrue({ id: 'u1', email: 'a@dymmsa.com' })
    const info = await verifyToken(req, makeToken({ client_id: 'cualquiera', exp: 1234 }))
    expect(info).toBeDefined()
  })

  test('éxito: AuthInfo sin scopes ni resource (Supabase no los emite), extra = identidad', async () => {
    process.env.MCP_OAUTH_CLIENT_IDS = 'claude-1'
    mockGoTrue({ id: 'u1', email: 'a@dymmsa.com' })
    const token = makeToken({ client_id: 'claude-1', exp: 1234 })

    const info = await verifyToken(req, token)

    expect(info).toMatchObject({
      token,
      clientId: 'claude-1',
      scopes: [],
      expiresAt: 1234,
      extra: { userId: 'u1', email: 'a@dymmsa.com', clientId: 'claude-1' },
    })
    expect(info).not.toHaveProperty('resource')
  })
})

describe('verifyToken — caché de identidad', () => {
  test('no revalida contra GoTrue dentro del TTL', async () => {
    mockGoTrue({ id: 'u1' })
    const token = makeToken({ client_id: 'c1' })

    await verifyToken(req, token)
    await verifyToken(req, token)

    expect(getUser).toHaveBeenCalledTimes(1)
  })

  test('pasado el TTL vuelve a validar (revocar surte efecto)', async () => {
    vi.useFakeTimers()
    mockGoTrue({ id: 'u1' })
    const token = makeToken({ client_id: 'c1' })

    await verifyToken(req, token)
    vi.advanceTimersByTime(61_000)
    mockGoTrue(null, 'revoked')

    expect(await verifyToken(req, token)).toBeUndefined()
    expect(getUser).toHaveBeenCalledTimes(2)
  })

  test('REGLA: la identidad de un token JAMÁS se sirve a otro (aislamiento de la caché)', async () => {
    // El análogo dymmsa del test de caché-por-tenant: una instancia caliente de
    // Node se comparte entre usuarios; la clave (hash del token) impide fugas.
    const tokenA = makeToken({ client_id: 'c1', sub: 'user-a' })
    const tokenB = makeToken({ client_id: 'c1', sub: 'user-b' })

    mockGoTrue({ id: 'user-a', email: 'a@dymmsa.com' })
    const infoA = await verifyToken(req, tokenA)

    mockGoTrue({ id: 'user-b', email: 'b@dymmsa.com' })
    const infoB = await verifyToken(req, tokenB)

    expect((infoA?.extra as { userId: string }).userId).toBe('user-a')
    expect((infoB?.extra as { userId: string }).userId).toBe('user-b')
    expect(getUser).toHaveBeenCalledTimes(2) // una validación por token, sin cruce
  })

  test('no cachea errores: un fallo transitorio no se pega 60s', async () => {
    const token = makeToken({ client_id: 'c1' })
    getUser.mockRejectedValueOnce(new Error('red caída'))

    await expect(verifyToken(req, token)).rejects.toThrow('red caída')

    mockGoTrue({ id: 'u1' })
    expect(await verifyToken(req, token)).toBeDefined()
  })
})
