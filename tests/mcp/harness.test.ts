/** The harness itself (#155 A1): a call reaches the tool with the identity, so later tests never die on "Sin sesión". */

import { describe, test, expect, vi } from 'vitest'

vi.mock('@/lib/mcp/supabase', async () => {
  const { createMockSupabase } = await import('../helpers/supabase-mock')
  const db = createMockSupabase({ responses: { app_settings: { data: [{ key: 'cut_margin_mm', value: 5 }] } } })
  return { clientForToken: vi.fn(() => db), verifierClient: vi.fn() }
})

import { connectMcp, textOf } from './harness'

describe('harness del MCP', () => {
  test('una llamada lleva la identidad hasta la tool y regresa su resultado', async () => {
    const mcp = await connectMcp('member')
    try {
      const result = await mcp.call('get_app_settings')
      expect(result.isError).toBeFalsy()
      expect(JSON.parse(textOf(result))).toMatchObject({ corte: { margen_por_corte_mm: 5 }, guardadas: ['cut_margin_mm'] })
    } finally {
      await mcp.close()
    }
  })
})
