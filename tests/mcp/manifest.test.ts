/** Anti-drift (#118): every tool registered in server.ts is in the manifest the docs page renders, and vice versa. */

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOL_MANIFEST, groupByModule, manifestFor } from '@/lib/mcp/manifest'

const registered = [...readFileSync(join(process.cwd(), 'src/lib/mcp/server.ts'), 'utf8').matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1])

describe('manifiesto del MCP', () => {
  test('cada tool registrada esta en el manifiesto, y el manifiesto no inventa tools', () => {
    const listed = TOOL_MANIFEST.map((t) => t.name)
    expect(registered.filter((n) => !listed.includes(n)), 'registradas sin manifiesto').toEqual([])
    expect(listed.filter((n) => !registered.includes(n)), 'en el manifiesto sin registrar').toEqual([])
    expect(new Set(listed).size).toBe(listed.length)
  })

  test('las escrituras son exactamente las cinco aprobadas y cada una declara sus limites', () => {
    const writes = TOOL_MANIFEST.filter((t) => t.kind === 'write')
    expect(writes.map((t) => t.name).sort()).toEqual(['create_payable', 'create_task', 'mark_payable_paid', 'set_inventory_location', 'update_task'])
    for (const w of writes) expect(w.limits, w.name).toBeTruthy()
    // Odoo is read-only by design (ADR-025): no write may ever live in that block.
    expect(manifestFor('odoo').every((t) => t.kind === 'read' && t.name.startsWith('odoo_'))).toBe(true)
    expect(manifestFor('app').every((t) => !t.name.startsWith('odoo_'))).toBe(true)
  })

  test('cada entrada trae titulo y pregunta ejemplo; los modulos se agrupan en orden de aparicion', () => {
    for (const t of TOOL_MANIFEST) {
      expect(t.title.length, t.name).toBeGreaterThan(3)
      expect(t.example.length, t.name).toBeGreaterThan(8)
    }
    const groups = groupByModule(manifestFor('app'))
    expect(groups[0].module).toBe('Panorama')
    expect(groups.map((g) => g.module)).toContain('Finanzas')
    expect(groups.reduce((n, g) => n + g.tools.length, 0)).toBe(manifestFor('app').length)
  })
})
