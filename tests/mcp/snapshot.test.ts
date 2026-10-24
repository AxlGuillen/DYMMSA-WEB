/**
 * Golden snapshot of what a connector receives (#155 A1): tools/list and instructions per role, plus a size report.
 * A refactor must leave these files untouched; an intended change regenerates them with `bun run test:mcp-snapshot`
 * and the PR explains the diff.
 */

import { describe, test, expect } from 'vitest'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { McpRole } from '@/lib/mcp/manifest'
import { odooConnector } from '@/lib/mcp/connectors/odoo/connector'
import { authAs, connectMcp } from './harness'

const ROLES: McpRole[] = ['admin', 'member']

/** Characters each tool costs on the wire, biggest first, so a PR diff shows where the budget went. */
function sizeReport(role: McpRole, tools: Tool[]): string {
  const rows = tools.map((t) => ({ name: t.name, size: JSON.stringify(t).length })).sort((a, b) => b.size - a.size || a.name.localeCompare(b.name))
  const total = rows.reduce((n, r) => n + r.size, 0)
  const lines = rows.map((r) => `${String(r.size).padStart(6)}  ${r.name}`)
  return [`# tools/list (${role}): ${rows.length} tools, ${total} caracteres en el cable`, ...lines, ''].join('\n')
}

describe('snapshot del MCP', () => {
  test.each(ROLES)('tools/list, instrucciones y tamaños (%s)', async (role) => {
    const mcp = await connectMcp(role)
    try {
      const tools = await mcp.tools()
      await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot(`./__snapshots__/tools-list.${role}.json`)
      await expect(`${mcp.instructions ?? ''}\n`).toMatchFileSnapshot(`./__snapshots__/instructions.${role}.md`)
      await expect(sizeReport(role, tools)).toMatchFileSnapshot(`./__snapshots__/tools-size.${role}.txt`)
    } finally {
      await mcp.close()
    }
  })

  // «Odoo DYMMSA» at /api/odoo/mcp (#155 B1): its own list and instructions, in their own files.
  test.each(ROLES)('conector Odoo: tools/list, instrucciones y tamaños (%s)', async (role) => {
    const mcp = await connectMcp(role, authAs(role), odooConnector)
    try {
      const tools = await mcp.tools()
      await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot(`./__snapshots__/tools-list.odoo.${role}.json`)
      await expect(`${mcp.instructions ?? ''}\n`).toMatchFileSnapshot(`./__snapshots__/instructions.odoo.${role}.md`)
      await expect(sizeReport(role, tools)).toMatchFileSnapshot(`./__snapshots__/tools-size.odoo.${role}.txt`)
    } finally {
      await mcp.close()
    }
  })
})
