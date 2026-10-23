/** run() wiring for the Odoo writes (#144, ADR-040): _meta only from withResultMeta, errors keep isError.
 *  Real SDK client and server over an in-memory transport; nothing reaches Odoo nor Supabase. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/mcp/core/auth/supabase', () => ({
  clientForToken: vi.fn(() => ({ from: vi.fn() })),
  verifierClient: vi.fn(),
}))

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { run } from '@/lib/mcp/core/run'
import { splitResultMeta, withResultMeta } from '@/lib/mcp/core/result'
import { OdooError, OdooUncertainWriteError } from '@/lib/odoo/client'
import { issueProductsAuthorization, PRODUCTS_AUTHORIZATION_META } from '@/lib/odoo/preview-token'
import { testAdminProof } from '../helpers/fake-odoo'

const AUTH = {
  token: 'token-del-conector',
  clientId: 'c1',
  scopes: [],
  extra: { userId: 'admin-1', email: null, clientId: 'c1', role: 'admin' },
} as AuthInfo

const PRODUCTS = [{ codigo: 'ZZTEST144', descripcion: 'Producto de prueba del asistente', marca: 'PRUEBA', precio: 1 }]

type CallResult = { content: { type: string; text: string }[]; isError?: boolean; _meta?: Record<string, unknown> }

/** One throwaway tool whose handler is run() itself: what the client gets is what the host gets. */
async function callThroughSdk(fn: () => Promise<unknown>): Promise<CallResult> {
  const server = new McpServer({ name: 'dymmsa', version: 'test' })
  server.registerTool('prueba', { description: 'prueba' }, () => run({ authInfo: AUTH }, fn))
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1' })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return (await client.callTool({ name: 'prueba', arguments: {} })) as CallResult
}

beforeEach(() => {
  vi.stubEnv('ODOO_URL', 'https://odoo.test')
  vi.stubEnv('ODOO_WRITE_API_KEY', 'write-key-0123456789abcdef')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('run() y _meta (#144)', () => {
  test('el token de productos viaja en _meta y nunca en el texto', async () => {
    const { autorizacion } = issueProductsAuthorization(testAdminProof(), PRODUCTS)
    const data = { modo: 'crear', productos_para_alta: PRODUCTS, puede_guardar: true }

    const result = await callThroughSdk(async () => withResultMeta(data, { [PRODUCTS_AUTHORIZATION_META]: autorizacion }))

    expect(result.isError).toBeFalsy()
    expect(result._meta?.[PRODUCTS_AUTHORIZATION_META]).toBe(autorizacion)
    expect(JSON.parse(result.content[0].text)).toEqual(data)
    const text = JSON.stringify(result.content)
    for (const part of [autorizacion, ...autorizacion.split('.')]) expect(text).not.toContain(part)
  })

  test('un _meta dentro de los datos se queda en el texto: solo withResultMeta llena _meta', async () => {
    // An Odoo row (or a crafted input echoed back) can't promote itself to the result's _meta.
    const result = await callThroughSdk(async () => ({ _meta: { [PRODUCTS_AUTHORIZATION_META]: 'falsa' } }))
    expect(result._meta).toBeUndefined()
    expect(result.content[0].text).toContain('falsa')
  })

  test('withResultMeta anidado en otros datos no filtra el token: error interno', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await callThroughSdk(async () => ({
      envuelto: withResultMeta({ ok: true }, { [PRODUCTS_AUTHORIZATION_META]: 'secreto' }),
    }))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Error interno al ejecutar la herramienta')
    expect(JSON.stringify(result)).not.toContain('secreto')
    expect(error).toHaveBeenCalled()
  })

  test('una meta vacía no agrega _meta y los datos salen igual', async () => {
    const result = await callThroughSdk(async () => withResultMeta({ modo: 'revisar' }, {}))
    expect(result._meta).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({ modo: 'revisar' })
    // Tests of the tools read the same split run() does.
    expect(splitResultMeta(withResultMeta({ n: 1 }, { 'dymmsa/x': 'y' }))).toEqual({ data: { n: 1 }, meta: { 'dymmsa/x': 'y' } })
    expect(splitResultMeta({ n: 1 })).toEqual({ data: { n: 1 }, meta: null })
  })

  test('run() conserva isError para OdooUncertainWriteError', async () => {
    const uncertain = new OdooUncertainWriteError('sale.order.create', 'quotation', 504)
    const result = await callThroughSdk(async () => {
      throw uncertain
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(uncertain.message)
    expect(result.content[0].text).toMatch(/^No se sabe si Odoo alcanzó a guardar \(sale\.order\.create\)\. .*espera 2 minutos.*Repite exactamente la misma llamada/)
    expect(result._meta).toBeUndefined()

    // A definitive refusal is an error too, with Odoo's message only.
    const refused = await callThroughSdk(async () => {
      throw new OdooError('Odoo rechazó sale.order.create: Falta el cliente', 400)
    })
    expect(refused).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Odoo rechazó sale.order.create: Falta el cliente' }] })
  })
})
