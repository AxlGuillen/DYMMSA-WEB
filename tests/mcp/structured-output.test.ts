/**
 * structuredContent and outputSchema through the real SDK (#155 C3): the server checks each result against the
 * zod output and the client against the JSON Schema it listed, so a view's contract is proven on every call.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/mcp/core/auth/supabase', async () => {
  const { createMockSupabase, filterValue } = await import('../helpers/supabase-mock')
  const mapped = [
    { id: 'u-tania', display_name: 'Tania', clock_employee_id: 5 },
    { id: 'u-santi', display_name: 'Santi', clock_employee_id: 2 },
  ]
  const db = createMockSupabase({
    responses: {
      // One row by id is the live role check of the Odoo preview; the list is the clock's profiles.
      profiles: (rec) =>
        filterValue(rec, 'id') ? { data: { role: 'admin', display_name: 'Ana Admin' }, error: null } : { data: mapped, error: null },
      app_settings: { data: [{ key: 'cut_margin_mm', value: 5 }], error: null },
    },
  })
  return { clientForToken: vi.fn(() => db), verifierClient: vi.fn() }
})

import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { defineTool } from '@/lib/mcp/core/define'
import { registerTools } from '@/lib/mcp/core/register'
import { previewTimeReportOutput } from '@/lib/mcp/tools/hours'
import { odooPreviewQuotation, previewQuotationOutput, type PreviewQuotationInput } from '@/lib/mcp/tools/odoo/quotations'
import { odooConnector } from '@/lib/mcp/connectors/odoo/connector'
import { PRODUCTS_AUTHORIZATION_META } from '@/lib/odoo/preview-token'
import { authAs, connectMcp, textOf } from './harness'
import { NGTECO_WEEK } from '../helpers/fixtures/ngteco'
import { fakeOdoo, throwingWriter } from '../helpers/fake-odoo'

beforeEach(() => {
  vi.stubEnv('ODOO_URL', 'https://odoo.test')
  vi.stubEnv('ODOO_WRITE_API_KEY', 'write-key-0123456789abcdef')
  vi.stubEnv('ODOO_DB', '')
})

afterEach(() => vi.unstubAllEnvs())

/** The text and structuredContent are the same JSON: what the model reads is what the view reads. */
function expectSameJson(result: CallToolResult) {
  expect(result.isError, textOf(result)).toBeFalsy()
  expect(result.structuredContent).toBeDefined()
  expect(result.structuredContent).toEqual(JSON.parse(textOf(result)))
}

describe('preview_time_report: su output completo (#155 C3)', () => {
  test('tools/list anuncia el outputSchema estricto y la llamada lo cumple en el servidor y en el cliente', async () => {
    const mcp = await connectMcp('admin')
    try {
      // Listing first makes the client cache the schema and check each result with it.
      const tool = (await mcp.tools()).find((t) => t.name === 'preview_time_report')
      expect(tool?.outputSchema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(Object.keys(tool?.outputSchema?.properties ?? {})).toEqual(Object.keys(previewTimeReportOutput.shape))

      const result = await mcp.call('preview_time_report', { filas: NGTECO_WEEK, nombre_archivo: 'semana.xls' })
      expectSameJson(result)
      expect(previewTimeReportOutput.parse(result.structuredContent)).toEqual(result.structuredContent)
      expect(result.structuredContent).toMatchObject({ periodo: { inicio: '2026-08-31', fin: '2026-09-06' }, cuadra: true, no_vinieron_en_el_reporte: ['Santi'] })
    } finally {
      await mcp.close()
    }
  })

  test('un error sigue siendo solo texto, sin structuredContent: el SDK no lo compara contra el output', async () => {
    const mcp = await connectMcp('admin')
    try {
      await mcp.tools()
      const result = await mcp.call('preview_time_report', { filas: NGTECO_WEEK.filter((r) => r[0] !== 'Período de pago') })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/Período de pago/)
      expect(result).not.toHaveProperty('structuredContent')
    } finally {
      await mcp.close()
    }
  })
})

describe('odoo_preview_quotation: su output mínimo (#155 C3)', () => {
  const input: PreviewQuotationInput = {
    cliente: '#1',
    lineas: [
      { nota: 'PRUEBA #155' },
      { producto_id: 30888, cantidad: 1, precio: 1 },
      { codigo: 'ZZTEST155', descripcion: 'Producto de prueba', marca: 'PRUEBA', cantidad: 1, precio: 1 },
    ],
  }
  const script = {
    'res.partner.search_read': [[{ id: 1, name: 'DISTRIBUCIONES Y MANUFACTURAS DE MICHOACAN', vat: 'DMM020826363', active: true }]],
    'product.product.search_read': [
      [{ id: 30888, name: 'Re pintado', default_code: false, type: 'service', is_storable: false, invoice_policy: 'order', sale_ok: true, active: true, list_price: 0, uom_id: [8, 'm'], unspsc_code_id: [53100, '73181104 Painting services'] }],
    ],
    'sale.order.search_read': [[]],
    'product.unspsc.code.search_read': [[{ id: 900, code: '31211507', name: 'Pinturas en aerosol' }]],
  }

  test('la vista previa real pasa su outputSchema en los dos lados; lo que no describe también viaja, y la autorización solo en _meta', async () => {
    const { odoo } = fakeOdoo(script)
    const { writer } = throwingWriter()
    const tools = odooConnector.tools.map((t) =>
      t.name === 'odoo_preview_quotation' ? { ...t, handler: (args: never, ctx: never) => odooPreviewQuotation({ reader: odoo, writer }, ctx, args) } : t,
    )
    const mcp = await connectMcp('admin', authAs('admin'), { ...odooConnector, tools })
    try {
      const listed = (await mcp.tools()).find((t) => t.name === 'odoo_preview_quotation')
      // Loose on purpose (ODOO_BUDGET): the envelope and the lists are checked, each line stays typed in TS.
      expect(listed?.outputSchema).toMatchObject({ type: 'object', additionalProperties: {} })

      const result = await mcp.call('odoo_preview_quotation', input)
      expectSameJson(result)
      expect(() => previewQuotationOutput.parse(result.structuredContent)).not.toThrow()
      expect(result.structuredContent).toMatchObject({ modo: 'crear', puede_guardar: true, cliente: { id: 1 }, subtotal: 2, productos_para_alta: [{ codigo: 'ZZTEST155' }] })
      const autorizacion = result._meta?.[PRODUCTS_AUTHORIZATION_META]
      expect(autorizacion).toEqual(expect.any(String))
      expect(JSON.stringify(result.structuredContent)).not.toContain(String(autorizacion))
    } finally {
      await mcp.close()
    }
  })
})

describe('el resto de las tools: structuredContent sin outputSchema (#155 C3)', () => {
  test('una lectura sin output no anuncia outputSchema y aun así trae su JSON como structuredContent', async () => {
    const mcp = await connectMcp('member')
    try {
      const tools = await mcp.tools()
      expect(tools.filter((t) => t.outputSchema).map((t) => t.name)).toEqual([])
      const result = await mcp.call('get_app_settings')
      expectSameJson(result)
      expect(result.structuredContent).toMatchObject({ corte: { margen_por_corte_mm: 5 } })
    } finally {
      await mcp.close()
    }
  })
})

describe('por qué un output es estricto o abierto, nunca un z.object normal', () => {
  async function callStub(output: z.ZodObject, data: unknown) {
    const tool = defineTool({
      connector: 'dymmsa',
      name: 'get_prueba',
      kind: 'read',
      title: 'Prueba',
      description: 'Lectura de prueba que devuelve lo que el test le pide, contra su output.',
      input: {},
      output: output as never,
      hints: { openWorldHint: false },
      docs: { module: 'Pruebas', title: 'Prueba', example: '—' },
      handler: async () => data as never,
    })
    const server = new McpServer({ name: 'prueba', version: '1' })
    registerTools(server, [tool], 'admin')
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const send = clientSide.send.bind(clientSide)
    clientSide.send = (message, options) => send(message, { ...options, authInfo: authAs('admin') })
    const client = new Client({ name: 'test', version: '1' })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    try {
      await client.listTools()
      return await client.callTool({ name: 'get_prueba', arguments: {} })
    } catch (error) {
      return error as Error
    } finally {
      await client.close()
    }
  }

  test('lo que no cumple el output es isError del servidor (en inglés, del SDK): el test de cada vista lo atrapa antes', async () => {
    const result = (await callStub(z.strictObject({ a: z.string() }), { a: 1 })) as CallToolResult
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^MCP error -32602: Output validation error: Invalid structured content for tool get_prueba/)
  })

  test('un z.object normal deja pasar llaves de más en el servidor, pero su JSON Schema las prohíbe y el cliente lo rechaza', async () => {
    const result = await callStub(z.object({ a: z.string() }), { a: 'x', b: 1 })
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/Structured content does not match the tool's output schema/)
    for (const ok of [z.strictObject({ a: z.string(), b: z.number() }), z.looseObject({ a: z.string() })]) {
      expectSameJson((await callStub(ok, { a: 'x', b: 1 })) as CallToolResult)
    }
  })
})
