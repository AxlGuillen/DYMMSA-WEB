/**
 * Anti-drift (#118): every registered tool is in the manifest the docs page renders, and vice versa
 * (compared against each connector's real registry since #155 A3/B3). Since #133 it also holds the role split and the
 * per-tool caps (ADR-034); each connector's own caps are measured in connectors.test.ts (ADR-041).
 */

import { describe, test, expect } from 'vitest'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { TOOL_BUDGET, groupByModule, type McpRole, type ToolBlock } from '@/lib/mcp/manifest'
import { ADMIN_ONLY_TOOLS, DOCS_MANIFEST, TOOL_MANIFEST, manifestFor, manifestForRole } from '@/lib/mcp/catalog'
import { registerTools } from '@/lib/mcp/core/register'
import type { ConnectorDefinition } from '@/lib/mcp/core/define'
import { dymmsaConnector } from '@/lib/mcp/connectors/dymmsa/connector'
import { odooConnector } from '@/lib/mcp/connectors/odoo/connector'

interface Registered { name: string; description: string; readOnly: boolean; view?: string }

/** Each connector with the manifest block it serves (#155 B3: /api/mcp no longer serves the odoo_* tools). */
const CONNECTORS: readonly (readonly [ToolBlock, ConnectorDefinition])[] = [['app', dymmsaConnector], ['odoo', odooConnector]]

/** What a connector serves a role in tools/list, captured from its own list. */
function registryFor(connector: ConnectorDefinition, role: McpRole): { tools: Registered[]; resources: { uri: string; mimeType?: string; html: () => Promise<unknown> }[] } {
  const out: Registered[] = []
  const resources: { uri: string; mimeType?: string; html: () => Promise<unknown> }[] = []
  const stub = {
    registerResource(_name: string, uri: string, cfg: { mimeType?: string }, read: () => Promise<unknown>) {
      resources.push({ uri, mimeType: cfg.mimeType, html: read })
    },
    registerTool(
      name: string,
      cfg: { title?: string; description?: string; inputSchema?: Record<string, z.ZodTypeAny>; annotations?: { readOnlyHint?: boolean }; _meta?: { ui?: { resourceUri?: string } } },
    ) {
      out.push({
        name,
        description: cfg.description ?? '',
        readOnly: cfg.annotations?.readOnlyHint !== false,
        view: cfg._meta?.ui?.resourceUri,
      })
    },
  }
  registerTools(stub as unknown as McpServer, connector.tools, role)
  return { tools: out, resources }
}

/** Both connectors' lists for a role, which together are the whole catalog. */
const allToolsFor = (role: McpRole) => CONNECTORS.flatMap(([, connector]) => registryFor(connector, role).tools)

describe('manifiesto del MCP', () => {
  test.each(CONNECTORS)('cada tool que registra el conector (%s) esta en su bloque del manifiesto, y el manifiesto no inventa tools', (block, connector) => {
    const registered = registryFor(connector, 'admin').tools.map((t) => t.name)
    expect(new Set(registered).size).toBe(registered.length)
    const listed = manifestFor(block).map((t) => t.name)
    expect(registered.filter((n) => !listed.includes(n)), 'registradas sin manifiesto').toEqual([])
    expect(listed.filter((n) => !registered.includes(n)), 'en el manifiesto sin registrar').toEqual([])
  })

  test('entre los dos conectores estan todas las tools del manifiesto, sin repetir nombres', () => {
    const listed = TOOL_MANIFEST.map((t) => t.name)
    expect(new Set(listed).size).toBe(listed.length)
    expect(allToolsFor('admin').map((t) => t.name).sort()).toEqual([...listed].sort())
  })

  test('las escrituras son exactamente las aprobadas y cada una declara sus limites', () => {
    const writes = TOOL_MANIFEST.filter((t) => t.kind === 'write')
    expect(writes.filter((t) => t.block === 'app').map((t) => t.name).sort()).toEqual(['create_payable', 'create_task', 'mark_payable_paid', 'record_payroll_hours', 'save_excused_day', 'save_material_presentation', 'save_payroll_employee', 'save_supplier', 'save_time_entries', 'set_inventory_location', 'update_payable', 'update_task'])
    for (const w of writes) expect(w.limits, w.name).toBeTruthy()
    expect(manifestFor('odoo').every((t) => t.name.startsWith('odoo_'))).toBe(true)
    expect(manifestFor('app').every((t) => !t.name.startsWith('odoo_'))).toBe(true)
  })

  test('REGLA (ADR-040): en Odoo solo escriben las de #144 más confirmar (#155 B2b), todas de administrador y marcadas como escritura en el registro', () => {
    const odooWrites = manifestFor('odoo').filter((t) => t.kind === 'write')
    expect(odooWrites.map((t) => t.name).sort()).toEqual([
      'odoo_confirm_quotation', 'odoo_create_draft_invoice', 'odoo_save_product', 'odoo_save_quotation',
    ])
    for (const w of odooWrites) expect(w.adminOnly, w.name).toBe(true)
    // The preview only reads, but it signs keys: admin-only as well.
    expect(TOOL_MANIFEST.find((t) => t.name === 'odoo_preview_quotation')).toMatchObject({ kind: 'read', adminOnly: true })
    const registeredTools = allToolsFor('admin')
    for (const t of TOOL_MANIFEST) {
      expect(registeredTools.find((r) => r.name === t.name)?.readOnly, t.name).toBe(t.kind === 'read')
    }
  })

  test('las tools de administrador existen pero no salen en la documentacion que lee todo el equipo (#123, #133)', () => {
    expect([...ADMIN_ONLY_TOOLS].sort()).toEqual(['get_payroll_period', 'list_time_imports', 'odoo_confirm_quotation', 'odoo_create_draft_invoice', 'odoo_preview_quotation', 'odoo_save_product', 'odoo_save_quotation', 'preview_time_report', 'record_payroll_hours', 'save_excused_day', 'save_payroll_employee', 'save_time_entries'])
    expect(DOCS_MANIFEST.some((t) => t.adminOnly || t.module === 'Nomina' || t.name.includes('payroll'))).toBe(false)
    expect(DOCS_MANIFEST).toHaveLength(TOOL_MANIFEST.length - ADMIN_ONLY_TOOLS.size)
  })

  test.each(CONNECTORS)('REGLA: en %s un member recibe la lista sin las tools de administrador; un admin las recibe todas (#133)', (block, connector) => {
    const admin = registryFor(connector, 'admin').tools.map((t) => t.name)
    const member = registryFor(connector, 'member').tools.map((t) => t.name)
    const adminOnly = manifestFor(block).filter((t) => t.adminOnly).map((t) => t.name)
    expect(admin.sort()).toEqual(manifestFor(block).map((t) => t.name).sort())
    expect(member.sort()).toEqual(manifestForRole('member').filter((t) => t.block === block).map((t) => t.name).sort())
    // core/register.ts skips the adminOnly definitions for a member (#133): the member list must lack exactly those.
    for (const name of adminOnly) expect(member, name).not.toContain(name)
    expect(member).toHaveLength(admin.length - adminOnly.length)
  })

  test.each(CONNECTORS)('las instrucciones de %s nombran sus tools de administrador solo al admin (#133)', (block, connector) => {
    const member = connector.instructions('member')
    const admin = connector.instructions('admin')
    for (const { name } of manifestFor(block).filter((t) => t.adminOnly)) {
      expect(member, name).not.toContain(name)
      expect(admin, name).toContain(name)
    }
  })

  test('las instrucciones de DYMMSA-WEB no le cuentan la nomina a un member ni nombran ninguna tool de Odoo (#133, #155 B3)', () => {
    const member = dymmsaConnector.instructions('member')
    const admin = dymmsaConnector.instructions('admin')
    expect(member).not.toMatch(/N[oó]mina/)
    // The sheet guide rides with record_payroll_hours, not with every conversation.
    expect(admin).not.toContain('Hoja de asistencia')
    expect(registryFor(dymmsaConnector, 'admin').tools.find((t) => t.name === 'record_payroll_hours')?.description).toContain('CÓMO LEER LA HOJA')
    for (const { name } of manifestFor('odoo')) {
      expect(admin, name).not.toContain(name)
      expect(member, name).not.toContain(name)
    }
    // The golden rule is now about two connectors, and says what to do when asked to carry something across.
    for (const text of [admin, member]) {
      expect(text).toContain('## Dos conectores, sin vínculo')
      expect(text).toContain('«Odoo DYMMSA»')
      expect(text).toMatch(/nunca asumas que una cotización de aquí es una de Odoo/)
    }
  })

  test('PRESUPUESTO (ADR-034): cada descripcion dentro de su tope, y las excepciones nombran tools que existen', () => {
    const tools = allToolsFor('admin')
    for (const t of tools) {
      const cap = TOOL_BUDGET.descriptionExceptions[t.name] ?? TOOL_BUDGET.description
      expect(t.description.length, `${t.name}: ${t.description.length} caracteres, tope ${cap}`).toBeLessThanOrEqual(cap)
      expect(t.description.length, `${t.name} sin descripcion`).toBeGreaterThan(40)
    }
    // The exception list only names tools that exist, so it cannot hide a dead entry.
    for (const name of Object.keys(TOOL_BUDGET.descriptionExceptions)) expect(tools.map((t) => t.name)).toContain(name)
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

  test.each([
    ['app', dymmsaConnector, ['preview_time_report']],
    ['odoo', odooConnector, ['odoo_preview_quotation']],
  ] as const)('VISTAS (ADR-036) en %s: cada tool con vista apunta a un recurso ui:// del mismo conector y rol; un member no recibe ninguno', async (_block, connector, expected) => {
    const admin = registryFor(connector, 'admin')
    const withView = admin.tools.filter((t) => t.view)
    expect(withView.map((t) => t.name).sort()).toEqual([...expected])
    for (const tool of withView) {
      expect(tool.readOnly, tool.name).toBe(true)
      const resource = admin.resources.find((r) => r.uri === tool.view)
      expect(resource, tool.name).toBeDefined()
      expect(resource?.mimeType).toBe('text/html;profile=mcp-app')
      const read = (await resource!.html()) as { contents: { uri: string; mimeType: string; text: string }[] }
      expect(read.contents[0]).toMatchObject({ uri: tool.view, mimeType: 'text/html;profile=mcp-app' })
      // Self-contained: no external script, stylesheet or font the host sandbox would have to allow.
      expect(read.contents[0].text).toMatch(/^<!doctype html>/)
      expect(read.contents[0].text).not.toMatch(/<(script|link)[^>]+(src|href)=["']https?:/i)
    }
    // A view travels with its tool: the other connector never registers it.
    expect(admin.resources.map((r) => r.uri).sort()).toEqual(withView.map((t) => t.view).sort())
    expect(registryFor(connector, 'member').resources).toEqual([])
  })
})
