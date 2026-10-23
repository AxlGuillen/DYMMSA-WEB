import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { McpRole } from '../manifest'
import type { ToolDefinition, ToolView } from './define'
import { run } from './run'

/** Registers the definitions in order: the order of tools/list is the order of the array. */
export function registerTools(server: McpServer, tools: readonly ToolDefinition[], role: McpRole): void {
  for (const tool of tools) {
    if (tool.adminOnly && role !== 'admin') continue
    const config = { title: tool.title, description: tool.description, inputSchema: tool.input, annotations: tool.annotations }
    // The SDK types the callback per input shape; a heterogeneous list can only be bridged here, once.
    const callback = ((input: unknown, extra: { authInfo?: AuthInfo }) =>
      run(extra, (_db, ctx) => tool.handler(input as never, ctx))) as never
    // Additive: a tool with its own view AND visibility ['app'] must stay hidden from the model (#144).
    const ui = {
      ...(tool.view ? { resourceUri: tool.view.uri } : {}),
      ...(tool.visibility ? { visibility: [...tool.visibility] } : {}),
    }
    if (Object.keys(ui).length > 0) registerAppTool(server, tool.name, { ...config, _meta: { ui } }, callback)
    else server.registerTool(tool.name, config, callback)
    if (tool.view) registerView(server, tool.view)
  }
}

function registerView(server: McpServer, view: ToolView): void {
  registerAppResource(server, view.name, view.uri, { description: view.description }, async () => ({
    contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: view.html(), _meta: { ui: { prefersBorder: true } } }],
  }))
}
