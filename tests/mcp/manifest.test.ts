/**
 * Anti-drift (#118): every tool registered in server.ts is in the manifest the docs page renders, and
 * vice versa. Since #133 it also holds the role split and the budget (ADR-034): a member's list never
 * carries an admin-only tool, and every tool has to fit in the caps or raise them on purpose.
 */

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  ADMIN_ONLY_TOOLS,
  DOCS_MANIFEST,
  TOOL_BUDGET,
  TOOL_MANIFEST,
  groupByModule,
  manifestFor,
  manifestForRole,
  type McpRole,
} from '@/lib/mcp/manifest'
import { registerDymmsaTools, serverInstructions } from '@/lib/mcp/server'

const serverSrc = readFileSync(join(process.cwd(), 'src/lib/mcp/server.ts'), 'utf8')
const registered = [...serverSrc.matchAll(/register(?:App)?Tool\(\s*(?:server,\s*)?'([a-z_]+)'/g)].map((m) => m[1])

interface Registered { name: string; description: string; readOnly: boolean; view?: string; /** name + title + description + JSON schema + _meta */ size: number }

/** What a connector of this role would get in tools/list, captured from the real registry. */
function registryFor(role: McpRole): { tools: Registered[]; resources: { uri: string; mimeType?: string; html: () => Promise<unknown> }[] } {
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
      // The schema is half of what the client pays (review PR #136): measured as the JSON the SDK would send.
      const schema = JSON.stringify(z.toJSONSchema(z.object(cfg.inputSchema ?? {})))
      const description = cfg.description ?? ''
      out.push({
        name,
        description,
        readOnly: cfg.annotations?.readOnlyHint !== false,
        view: cfg._meta?.ui?.resourceUri,
        size: name.length + (cfg.title ?? '').length + description.length + schema.length + JSON.stringify(cfg._meta ?? {}).length,
      })
    },
  }
  registerDymmsaTools(stub as unknown as McpServer, role)
  return { tools: out, resources }
}

const toolsFor = (role: McpRole) => registryFor(role).tools

describe('manifiesto del MCP', () => {
  test('cada tool registrada esta en el manifiesto, y el manifiesto no inventa tools', () => {
    // A registerTool with double quotes or a computed name would slip past the regex unseen (review PR #119).
    expect(registered.length).toBe([...serverSrc.matchAll(/register(?:App)?Tool\(/g)].length)
    const listed = TOOL_MANIFEST.map((t) => t.name)
    expect(registered.filter((n) => !listed.includes(n)), 'registradas sin manifiesto').toEqual([])
    expect(listed.filter((n) => !registered.includes(n)), 'en el manifiesto sin registrar').toEqual([])
    expect(new Set(listed).size).toBe(listed.length)
  })

  test('las escrituras son exactamente las nueve aprobadas y cada una declara sus limites', () => {
    const writes = TOOL_MANIFEST.filter((t) => t.kind === 'write')
    expect(writes.map((t) => t.name).sort()).toEqual(['create_payable', 'create_task', 'mark_payable_paid', 'record_payroll_hours', 'save_excused_day', 'save_supplier', 'save_time_entries', 'set_inventory_location', 'update_task'])
    for (const w of writes) expect(w.limits, w.name).toBeTruthy()
    // Odoo is read-only by design (ADR-025): no write may ever live in that block.
    expect(manifestFor('odoo').every((t) => t.kind === 'read' && t.name.startsWith('odoo_'))).toBe(true)
    expect(manifestFor('app').every((t) => !t.name.startsWith('odoo_'))).toBe(true)
  })

  test('las tools de administrador existen pero no salen en la documentacion que lee todo el equipo (#123, #133)', () => {
    expect([...ADMIN_ONLY_TOOLS].sort()).toEqual(['get_payroll_period', 'list_time_imports', 'preview_time_report', 'record_payroll_hours', 'save_excused_day', 'save_time_entries'])
    expect(DOCS_MANIFEST.some((t) => t.adminOnly || t.module === 'Nomina' || t.name.includes('payroll'))).toBe(false)
    expect(DOCS_MANIFEST).toHaveLength(TOOL_MANIFEST.length - ADMIN_ONLY_TOOLS.size)
  })

  test('REGLA: un member recibe la lista sin las tools de administrador; un admin las recibe todas (#133)', () => {
    const admin = toolsFor('admin').map((t) => t.name)
    const member = toolsFor('member').map((t) => t.name)
    expect(admin.sort()).toEqual(TOOL_MANIFEST.map((t) => t.name).sort())
    expect(member.sort()).toEqual(manifestForRole('member').map((t) => t.name).sort())
    // The guards in server.ts and the flags in the manifest must say the same thing.
    for (const name of ADMIN_ONLY_TOOLS) expect(member, name).not.toContain(name)
    expect(member).toHaveLength(admin.length - ADMIN_ONLY_TOOLS.size)
  })

  test('las instrucciones del servidor tampoco le cuentan a un member lo que no puede usar (#133)', () => {
    const member = serverInstructions('member')
    const admin = serverInstructions('admin')
    for (const name of ADMIN_ONLY_TOOLS) {
      expect(member, name).not.toContain(name)
      expect(admin, name).toContain(name)
    }
    expect(member).not.toMatch(/N[oó]mina/)
    // The sheet guide rides with record_payroll_hours, not with every conversation.
    expect(admin).not.toContain('Hoja de asistencia')
    expect(toolsFor('admin').find((t) => t.name === 'record_payroll_hours')?.description).toContain('CÓMO LEER LA HOJA')
  })

  test('PRESUPUESTO (ADR-034): numero de tools por bloque, largo de descripciones e instrucciones', () => {
    const app = manifestFor('app').length
    const odoo = manifestFor('odoo').length
    expect(app, `app: ${app} tools, tope ${TOOL_BUDGET.tools.app}`).toBeLessThanOrEqual(TOOL_BUDGET.tools.app)
    expect(odoo, `odoo: ${odoo} tools, tope ${TOOL_BUDGET.tools.odoo}`).toBeLessThanOrEqual(TOOL_BUDGET.tools.odoo)

    const tools = toolsFor('admin')
    for (const t of tools) {
      const cap = TOOL_BUDGET.descriptionExceptions[t.name] ?? TOOL_BUDGET.description
      expect(t.description.length, `${t.name}: ${t.description.length} caracteres, tope ${cap}`).toBeLessThanOrEqual(cap)
      expect(t.description.length, `${t.name} sin descripcion`).toBeGreaterThan(40)
    }
    const total = tools.reduce((n, t) => n + t.description.length, 0)
    expect(total, `descripciones: ${total} caracteres, tope ${TOOL_BUDGET.descriptionsTotal}`).toBeLessThanOrEqual(TOOL_BUDGET.descriptionsTotal)
    const list = tools.reduce((n, t) => n + t.size, 0)
    expect(list, `tools/list: ${list} caracteres, tope ${TOOL_BUDGET.listTotal}`).toBeLessThanOrEqual(TOOL_BUDGET.listTotal)
    // The exception list only names tools that exist, so it cannot hide a dead entry.
    for (const name of Object.keys(TOOL_BUDGET.descriptionExceptions)) expect(registered).toContain(name)

    for (const role of ['admin', 'member'] as const) {
      const len = serverInstructions(role).length
      expect(len, `instrucciones (${role}): ${len} caracteres, tope ${TOOL_BUDGET.instructions}`).toBeLessThanOrEqual(TOOL_BUDGET.instructions)
    }
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

  test('VISTAS (ADR-036): cada tool con vista apunta a un recurso ui:// registrado para el mismo rol; un member no recibe ninguno', async () => {
    const admin = registryFor('admin')
    const withView = admin.tools.filter((t) => t.view)
    expect(withView.map((t) => t.name)).toEqual(['preview_time_report'])
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
    expect(registryFor('member').resources).toEqual([])
  })
})
