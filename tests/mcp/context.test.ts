/**
 * contextFrom (ADR-023): resuelve el cliente Supabase por request a partir del
 * AuthInfo verificado. Sin identidad válida → ToolError legible para el
 * usuario del conector (no "error interno").
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/mcp/supabase', () => ({
  clientForToken: vi.fn(),
  verifierClient: vi.fn(),
}))

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { clientForToken } from '@/lib/mcp/supabase'
import { contextFrom } from '@/lib/mcp/context'
import { ToolError } from '@/lib/mcp/shared'

const FAKE_DB = { from: vi.fn() }

beforeEach(() => {
  vi.mocked(clientForToken).mockReset()
  vi.mocked(clientForToken).mockReturnValue(FAKE_DB as unknown as ReturnType<typeof clientForToken>)
})

function authInfo(extra: Record<string, unknown> | undefined, token = 'tok-1'): AuthInfo {
  return { token, clientId: 'c1', scopes: [], extra } as AuthInfo
}

describe('contextFrom', () => {
  test('sin authInfo → ToolError accionable', () => {
    expect(() => contextFrom(undefined)).toThrow(ToolError)
    expect(() => contextFrom(undefined)).toThrow(/vuelve a conectar/i)
  })

  test('authInfo sin identidad (extra vacío) → ToolError', () => {
    expect(() => contextFrom(authInfo(undefined))).toThrow(ToolError)
    expect(() => contextFrom(authInfo({}))).toThrow(ToolError)
  })

  test('construye el db con el token DEL REQUEST y expone la identidad', () => {
    const ctx = contextFrom(
      authInfo({ userId: 'u1', email: 'a@dymmsa.com', clientId: 'c1' }, 'token-abc'),
    )

    expect(clientForToken).toHaveBeenCalledWith('token-abc')
    expect(ctx.db).toBe(FAKE_DB)
    expect(ctx).toMatchObject({ userId: 'u1', email: 'a@dymmsa.com', clientId: 'c1' })
  })
})
