/**
 * The real route handlers, mcp-handler included (review PR #162): an authenticated tools/list reaches each
 * connector by its basePath. The harness skips mcp-handler, so without this a basePath typo would 404 in prod.
 */

import { describe, test, expect, vi } from 'vitest'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { authAs } from './harness'

vi.mock('@/lib/mcp/core/auth/oauth', () => ({
  verifyToken: vi.fn(async (_req: Request, token?: string) => (token ? authAs(token === 'admin' ? 'admin' : 'member') : undefined)),
}))

const { POST: dymmsaPost } = await import('@/app/api/[transport]/route')
const { POST: odooPost } = await import('@/app/api/odoo/[transport]/route')

type Handler = (req: Request) => Promise<Response>

/** Streamable HTTP answers JSON or one SSE event; both carry the same JSON-RPC body. */
async function rpc(handler: Handler, path: string, token: string | null, method = 'tools/list') {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await handler(
    new Request(`http://localhost:3000${path}`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }) }),
  )
  const text = await res.text()
  const json = text.startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? '')
  return { status: res.status, body: json ? (JSON.parse(json) as { result?: { tools?: Tool[] } }) : null }
}

const names = (body: { result?: { tools?: Tool[] } } | null) => (body?.result?.tools ?? []).map((t) => t.name)

describe('rutas MCP con mcp-handler', () => {
  test('/api/odoo/mcp autenticado sirve solo las tools de Odoo', async () => {
    const { status, body } = await rpc(odooPost as Handler, '/api/odoo/mcp', 'admin')
    expect(status).toBe(200)
    expect(names(body).length).toBeGreaterThan(0)
    expect(names(body).every((n) => n.startsWith('odoo_'))).toBe(true)
  })

  test('/api/mcp autenticado sirve DYMMSA-WEB', async () => {
    const { status, body } = await rpc(dymmsaPost as Handler, '/api/mcp', 'admin')
    expect(status).toBe(200)
    expect(names(body)).toContain('get_business_summary')
  })

  test('un member no recibe las tools de administrador en ninguna de las dos rutas', async () => {
    const odooMember = names((await rpc(odooPost as Handler, '/api/odoo/mcp', 'member')).body)
    expect(odooMember).not.toContain('odoo_save_quotation')
    expect(odooMember).not.toContain('odoo_confirm_quotation')
    expect(names((await rpc(dymmsaPost as Handler, '/api/mcp', 'member')).body)).not.toContain('record_payroll_hours')
  })

  test('sin token responde 401 con el metadata de su propio conector', async () => {
    const res = await (odooPost as Handler)(new Request('http://localhost:3000/api/odoo/mcp', { method: 'POST' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/api/odoo/mcp')
  })

  test('el handler de Odoo no contesta en la ruta de DYMMSA-WEB: el match es por basePath', async () => {
    const { status } = await rpc(odooPost as Handler, '/api/mcp', 'admin')
    expect(status).toBe(404)
  })
})
