/** Two connectors, one app (#155 B1, ADR-041): each endpoint announces its own resource and fits its budget. */

import { describe, test, expect, vi, afterEach } from 'vitest'
import { GET as protectedResource } from '@/app/.well-known/oauth-protected-resource/[[...path]]/route'
import { connectorPath } from '@/lib/mcp/core/define'
import { MCP_PATH, ODOO_MCP_PATH, protectedResourcePath } from '@/lib/mcp/core/routes'
import { dymmsaConnector } from '@/lib/mcp/connectors/dymmsa/connector'
import { ODOO_BUDGET, odooConnector } from '@/lib/mcp/connectors/odoo/connector'
import { ODOO_TOOLS } from '@/lib/mcp/connectors/odoo'
import { authAs, connectMcp } from './harness'

afterEach(() => vi.unstubAllEnvs())

/** The 15 names the catalog dropped in #155 B2a (renamed, fused or retired): none may linger in a text the model reads. */
const RETIRED_NAMES = [
  'odoo_query', 'odoo_aggregate', 'odoo_overdue_invoices', 'odoo_invoices_summary', 'odoo_sales_summary', 'odoo_customer_profile',
  'odoo_receivables_ranking', 'odoo_invoice_detail', 'odoo_sale_detail', 'odoo_payment_detail', 'odoo_rep_audit',
  'odoo_invoice_link_check', 'odoo_stock_check', 'odoo_employee_directory', 'odoo_fleet_status',
]

async function metadataFor(path: string[]) {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supa.test')
  const url = `http://localhost:3000/.well-known/oauth-protected-resource/${path.join('/')}`
  return protectedResource(new Request(url), { params: Promise.resolve({ path }) })
}

describe('rutas de los conectores', () => {
  test('cada conector vive en su ruta y anuncia su propio metadata', () => {
    expect(connectorPath(dymmsaConnector)).toBe(MCP_PATH)
    expect(connectorPath(odooConnector)).toBe(ODOO_MCP_PATH)
    expect(protectedResourcePath(MCP_PATH)).toBe('/.well-known/oauth-protected-resource')
    expect(protectedResourcePath(ODOO_MCP_PATH)).toBe('/.well-known/oauth-protected-resource/api/odoo/mcp')
  })

  test('RFC 9728: la raíz y /api/mcp anuncian DYMMSA-WEB; /api/odoo/mcp anuncia Odoo; otra ruta es 404', async () => {
    for (const path of [[], ['api', 'mcp']]) {
      const body = (await (await metadataFor(path)).json()) as { resource: string; authorization_servers: string[] }
      expect(body.resource, path.join('/')).toBe('http://localhost:3000/api/mcp')
      expect(body.authorization_servers).toEqual(['https://supa.test/auth/v1'])
    }
    const odoo = (await (await metadataFor(['api', 'odoo', 'mcp'])).json()) as { resource: string }
    expect(odoo.resource).toBe('http://localhost:3000/api/odoo/mcp')
    const missing = await metadataFor(['api', 'otra'])
    expect(missing.status).toBe(404)
    expect(missing.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('conector Odoo DYMMSA', () => {
  test('solo sirve tools de Odoo, y DYMMSA-WEB las sigue sirviendo mientras dura la transición (B1 → B3)', () => {
    expect(odooConnector.tools.every((t) => t.connector === 'odoo')).toBe(true)
    expect(odooConnector.tools).toEqual(ODOO_TOOLS)
    expect(ODOO_TOOLS.every((t) => dymmsaConnector.tools.includes(t))).toBe(true)
  })

  test('PRESUPUESTO (ADR-041): tools, tools/list en el cable, descripciones e instrucciones por rol', async () => {
    const mcp = await connectMcp('admin', authAs('admin'), odooConnector)
    let tools: Awaited<ReturnType<typeof mcp.tools>>
    try {
      tools = await mcp.tools()
    } finally {
      await mcp.close()
    }
    expect(tools.length).toBeLessThanOrEqual(ODOO_BUDGET.tools)
    const list = tools.reduce((n, t) => n + JSON.stringify(t).length, 0)
    expect(list, `tools/list: ${list}`).toBeLessThanOrEqual(ODOO_BUDGET.listTotal)
    const descriptions = tools.reduce((n, t) => n + (t.description ?? '').length, 0)
    expect(descriptions, `descripciones: ${descriptions}`).toBeLessThanOrEqual(ODOO_BUDGET.descriptionsTotal)
    for (const role of ['admin', 'member'] as const) {
      expect(odooConnector.instructions(role).length, role).toBeLessThanOrEqual(ODOO_BUDGET.instructions)
    }
  })

  test('CATÁLOGO (ADR-041 §12): los nombres finales en su orden, y ningún nombre retirado en descripciones ni instrucciones', () => {
    expect(ODOO_TOOLS.map((t) => t.name)).toEqual([
      'odoo_get_document', 'odoo_get_customer', 'odoo_list_receivables', 'odoo_summarize_invoices', 'odoo_summarize_sales',
      'odoo_audit_invoice_links', 'odoo_audit_payment_complements', 'odoo_search_stock', 'odoo_search_records', 'odoo_aggregate_records',
      'odoo_preview_quotation', 'odoo_save_quotation', 'odoo_save_product', 'odoo_create_draft_invoice',
    ])
    const texts = [
      ...[...dymmsaConnector.tools, ...odooConnector.tools].map((t) => t.description),
      ...(['admin', 'member'] as const).flatMap((role) => [odooConnector.instructions(role), dymmsaConnector.instructions(role)]),
    ]
    for (const name of RETIRED_NAMES) {
      const word = new RegExp(`\\b${name}\\b`)
      expect(texts.filter((text) => word.test(text)), name).toEqual([])
    }
  })

  test('sus instrucciones no prometen escrituras a un member', () => {
    expect(odooConnector.instructions('member')).toMatch(/SOLO lectura/)
    expect(odooConnector.instructions('member')).not.toMatch(/odoo_save_quotation|Cotizar y facturar \(solo/)
    expect(odooConnector.instructions('admin')).toMatch(/odoo_preview_quotation/)
  })
})
