/** Real SDK client ↔ server over an in-memory transport (#155 A1): what a connector gets is what the test gets. */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { registerDymmsaTools, serverInstructions } from '@/lib/mcp/server'
import type { McpRole } from '@/lib/mcp/manifest'

export interface McpHarness {
  client: Client
  /** Instructions as the client receives them in initialize. */
  instructions: string | undefined
  tools(): Promise<Tool[]>
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>
  close(): Promise<void>
}

/** The AuthInfo withMcpAuth hangs on each request; tools read the identity from `extra`. */
export function authAs(role: McpRole, userId = `${role}-1`): AuthInfo {
  return { token: `token-${userId}`, clientId: 'c1', scopes: [], extra: { userId, email: null, clientId: 'c1', role } }
}

/** The text of a result's first block, which is all our tools return today. */
export function textOf(result: CallToolResult): string {
  const block = result.content[0]
  return block?.type === 'text' ? block.text : ''
}

/**
 * Same registry and instructions as the /api/mcp route. Calls carry `authInfo`, as the route does.
 * serverInfo stays out on purpose: the route's depends on appUrl() (env); B1 moves it into the connector.
 */
export async function connectMcp(role: McpRole, authInfo: AuthInfo = authAs(role)): Promise<McpHarness> {
  const server = new McpServer({ name: 'dymmsa', version: 'test' }, { instructions: serverInstructions(role) })
  registerDymmsaTools(server, role)
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const send = clientSide.send.bind(clientSide)
  clientSide.send = (message, options) => send(message, { ...options, authInfo })
  const client = new Client({ name: 'test', version: '1' })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return {
    client,
    instructions: client.getInstructions(),
    tools: async () => (await client.listTools()).tools,
    call: async (name, args = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult,
    close: () => client.close(),
  }
}
