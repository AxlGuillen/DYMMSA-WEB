/** MCP App views (ADR-036): the committed HTML must be rebuilt whenever its sources change. */

import { describe, test, expect } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { MCP_VIEWS } from '@/lib/mcp/views/generated'
import { registerDymmsaTools } from '@/lib/mcp/server'
import type { McpRole } from '@/lib/mcp/manifest'
import { VIEWS, viewSourceHash } from '../../scripts/mcp-views'

describe('vistas MCP generadas', () => {
  test('cada vista está generada y al día con su código (si falla: bun run build:mcp-views)', () => {
    expect(Object.keys(MCP_VIEWS).sort()).toEqual([...VIEWS].sort())
    for (const name of VIEWS) expect(MCP_VIEWS[name].sourceHash, name).toBe(viewSourceHash(name))
  })

  test('el HTML es autocontenido: sin scripts, estilos ni fuentes externas', () => {
    for (const name of VIEWS) {
      const { html } = MCP_VIEWS[name]
      expect(html).toMatch(/^<!doctype html>/)
      expect(html).toContain('<main id="app"></main>')
      expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=/i)
      expect(html).not.toMatch(/@import\s+url\(\s*['"]?https?:/i)
    }
  })

  test('con el SDK real: el admin ve la tool con _meta.ui y lee el HTML; un member no ve ni la tool ni la vista', async () => {
    async function connect(role: McpRole) {
      const server = new McpServer({ name: 'dymmsa', version: 'test' })
      registerDymmsaTools(server, role)
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
      const client = new Client({ name: 'test', version: '1' })
      await Promise.all([server.connect(serverSide), client.connect(clientSide)])
      return client
    }

    const admin = await connect('admin')
    const tool = (await admin.listTools()).tools.find((t) => t.name === 'preview_time_report')
    expect(tool?._meta).toMatchObject({ ui: { resourceUri: 'ui://dymmsa/time-report.html' }, 'ui/resourceUri': 'ui://dymmsa/time-report.html' })
    expect(tool?.annotations?.readOnlyHint).toBe(true)
    const read = await admin.readResource({ uri: 'ui://dymmsa/time-report.html' })
    expect(read.contents[0]).toMatchObject({ mimeType: 'text/html;profile=mcp-app', text: MCP_VIEWS['time-report'].html })

    const member = await connect('member')
    expect((await member.listTools()).tools.map((t) => t.name)).not.toContain('preview_time_report')
    await expect(member.listResources()).rejects.toThrow()
  })
})
