/**
 * Auth del endpoint MCP: token compartido por Bearer header.
 * Regla crítica: sin MCP_API_KEY configurada se rechaza TODO (no degrada a sin-auth).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { extractBearerToken, isValidMcpToken, requireMcpAuth } from '@/lib/mcp/auth'

const req = (auth?: string) =>
  new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  })

beforeEach(() => {
  process.env.MCP_API_KEY = 'secreto-123'
})
afterEach(() => {
  delete process.env.MCP_API_KEY
})

describe('extractBearerToken', () => {
  test('extrae el token del header Bearer (case-insensitive, con espacios)', () => {
    expect(extractBearerToken(req('Bearer abc'))).toBe('abc')
    expect(extractBearerToken(req('bearer   abc  '))).toBe('abc')
  })

  test('null sin header o con esquema distinto', () => {
    expect(extractBearerToken(req())).toBeNull()
    expect(extractBearerToken(req('Basic abc'))).toBeNull()
  })
})

describe('isValidMcpToken', () => {
  test('true solo con el token exacto', () => {
    expect(isValidMcpToken('secreto-123')).toBe(true)
    expect(isValidMcpToken('secreto-124')).toBe(false)
    expect(isValidMcpToken(null)).toBe(false)
  })

  test('sin MCP_API_KEY configurada rechaza todo (nunca degrada a sin-auth)', () => {
    delete process.env.MCP_API_KEY
    expect(isValidMcpToken('secreto-123')).toBe(false)
    expect(isValidMcpToken('')).toBe(false)
  })
})

describe('requireMcpAuth', () => {
  const inner = async () => Response.json({ ok: true })

  test('401 sin token o con token inválido', async () => {
    const handler = requireMcpAuth(inner)
    expect((await handler(req())).status).toBe(401)
    expect((await handler(req('Bearer malo'))).status).toBe(401)
  })

  test('delega al handler con token válido', async () => {
    const handler = requireMcpAuth(inner)
    const res = await handler(req('Bearer secreto-123'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
