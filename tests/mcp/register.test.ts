/** core/register.ts (#155 A3): what a definition declares is what tools/list carries. */

import { test, expect } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { registerTools } from '@/lib/mcp/core/register'

const withViewAndButtonOnly = defineTool({
  connector: 'dymmsa',
  name: 'save_prueba',
  kind: 'write',
  title: 'Prueba',
  description: 'Escritura de prueba con su propia vista que solo llama el botón de esa vista.',
  input: {},
  annotations: { readOnlyHint: false, openWorldHint: false },
  view: { uri: 'ui://dymmsa/prueba.html', name: 'Vista: prueba', description: 'Prueba', html: () => '<!doctype html>' },
  visibility: ['app'],
  docs: { module: 'Pruebas', title: 'Prueba', example: '—', limits: '—' },
  handler: async () => ({}),
})

const adminRead = defineTool({
  connector: 'dymmsa',
  name: 'get_prueba',
  kind: 'read',
  title: 'Prueba de admin',
  description: 'Lectura de prueba que solo recibe un administrador en su lista de tools.',
  input: {},
  annotations: readOnly,
  adminOnly: true,
  docs: { module: 'Pruebas', title: 'Prueba', example: '—' },
  handler: async () => ({}),
})

async function listFor(role: 'admin' | 'member') {
  const server = new McpServer({ name: 'prueba', version: '1' })
  registerTools(server, [withViewAndButtonOnly, adminRead], role)
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1' })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  try {
    return (await client.listTools()).tools
  } finally {
    await client.close()
  }
}

test('una tool con vista y visibility ["app"] conserva las dos marcas (no queda visible para el modelo)', async () => {
  const tool = (await listFor('admin')).find((t) => t.name === 'save_prueba')
  expect(tool?._meta).toMatchObject({ ui: { resourceUri: 'ui://dymmsa/prueba.html', visibility: ['app'] } })
})

test('una definición adminOnly no se registra para un member', async () => {
  expect((await listFor('admin')).map((t) => t.name)).toContain('get_prueba')
  expect((await listFor('member')).map((t) => t.name)).not.toContain('get_prueba')
})
