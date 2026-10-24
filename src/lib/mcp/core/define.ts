/**
 * One declaration per tool (#155 A3, ADR-041): the registry, the manifest, the docs and the consent
 * screen are derived from it, so they cannot drift apart.
 */

import type { z } from 'zod'
import type { Implementation, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { McpContext } from './context'
import type { ConnectorBudget, McpRole, ToolKind } from '../manifest'

export type ConnectorId = 'dymmsa' | 'odoo'

/** What the in-app documentation and the consent screen say about the tool (#118, #133). */
export interface ToolDocs {
  /** Group shown in the docs (one per screen/module). */
  module: string
  title: string
  /** A question the user could ask that lands on this tool. */
  example: string
  /** Writes only: what the tool will never do. */
  limits?: string
}

/** An MCP Apps view (ADR-036), registered as a resource right after the tool that opens it. */
export interface ToolView {
  uri: string
  name: string
  description: string
  html: () => string
}

export interface ToolDefinition<S extends z.ZodRawShape = z.ZodRawShape> {
  connector: ConnectorId
  name: string
  kind: ToolKind
  title: string
  description: string
  input: S
  annotations: ToolAnnotations
  /** Not registered for a member (#133); the RLS is still the barrier. */
  adminOnly?: true
  view?: ToolView
  /** `['app']`: only its view's button calls it, never the model (#144). */
  visibility?: readonly ('model' | 'app')[]
  docs: ToolDocs
  // Method syntax on purpose: a list of definitions with different inputs stays assignable.
  handler(input: z.infer<z.ZodObject<S>>, ctx: McpContext): Promise<unknown>
}

export function defineTool<S extends z.ZodRawShape>(definition: ToolDefinition<S>): ToolDefinition<S> {
  return definition
}

/** One MCP endpoint (#155 B1, ADR-041): what it serves, under which path, with which instructions. */
export interface ConnectorDefinition {
  id: ConnectorId
  /** mcp-handler basePath: the endpoint is `${basePath}/mcp`. */
  basePath: string
  serverInfo: Implementation
  tools: readonly ToolDefinition[]
  instructions(role: McpRole): string
  /** Its own caps (ADR-041), measured by tests/mcp/connectors.test.ts. */
  budget: ConnectorBudget
}

export const connectorPath = (connector: Pick<ConnectorDefinition, 'basePath'>) => `${connector.basePath}/mcp`
