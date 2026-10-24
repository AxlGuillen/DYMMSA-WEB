/**
 * One declaration per tool (#155 A3, ADR-041): the registry, the manifest, the docs and the consent
 * screen are derived from it, so they cannot drift apart.
 */

import type { z } from 'zod'
import type { Implementation, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { McpContext } from './context'
import type { ResultWithMeta } from './result'
import type { ConnectorBudget, McpRole } from '../manifest'

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

/** A read changes nothing: never destructive, always idempotent (R8, #155 C2). Only its world is declared. */
export interface ReadHints {
  openWorldHint: boolean
}

/** A write states all three: the spec defaults (destructive, not idempotent) are the worst case, not the truth (R8). */
export interface WriteHints {
  /** false only if the tool just adds (or refreshes) and never overwrites nor removes. */
  destructiveHint: boolean
  /** true only if repeating the same call changes nothing more. */
  idempotentHint: boolean
  openWorldHint: boolean
}

/** An output contract (#155 C3): any zod object. The SDK checks structuredContent against it on every call. */
export type ToolOutput = z.ZodObject<z.core.$ZodShape, z.core.$ZodObjectConfig>

/** The JSON a schema accepts as a handler builds it: readonly arrays welcome, no index signature to satisfy. */
type Buildable<T> = T extends readonly (infer U)[]
  ? readonly Buildable<U>[]
  : T extends object
    ? { readonly [K in keyof T as string extends K ? never : K]: Buildable<T[K]> }
    : T

export type OutputOf<O extends ToolOutput> = Buildable<z.input<O>>

/** With `output`, the handler must return what the schema accepts, bare or wrapped by withResultMeta. */
export type HandlerResult<O extends ToolOutput | undefined> = [O] extends [ToolOutput]
  ? OutputOf<O> | ResultWithMeta<OutputOf<O>>
  : unknown

// No `annotations` and no readOnlyHint here: both come from `kind` in toolAnnotations(), so they cannot contradict it.
interface ToolDefinitionBase<S extends z.ZodRawShape, O extends ToolOutput | undefined> {
  connector: ConnectorId
  name: string
  title: string
  description: string
  input: S
  /** Only where a consumer reads it (§3.5): it travels in tools/list as outputSchema and costs budget. */
  output?: O
  /** Not registered for a member (#133); the RLS is still the barrier. */
  adminOnly?: true
  view?: ToolView
  /** `['app']`: only its view's button calls it, never the model (#144). */
  visibility?: readonly ('model' | 'app')[]
  docs: ToolDocs
  // Method syntax on purpose: a list of definitions with different inputs stays assignable.
  handler(input: z.infer<z.ZodObject<S>>, ctx: McpContext): Promise<HandlerResult<O>>
}

export type ToolDefinition<S extends z.ZodRawShape = z.ZodRawShape, O extends ToolOutput | undefined = ToolOutput | undefined> = ToolDefinitionBase<S, O> &
  ({ kind: 'read'; hints: ReadHints } | { kind: 'write'; hints: WriteHints })

export function defineTool<S extends z.ZodRawShape, O extends ToolOutput | undefined = undefined>(definition: ToolDefinition<S, O>): ToolDefinition<S, O> {
  return definition
}

/** The four MCP hints, always explicit and in the spec's order (R8, ADR-041 §10): what tools/list carries. */
export function toolAnnotations(tool: ToolDefinition): ToolAnnotations {
  if (tool.kind === 'read') return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: tool.hints.openWorldHint }
  const { destructiveHint, idempotentHint, openWorldHint } = tool.hints
  return { readOnlyHint: false, destructiveHint, idempotentHint, openWorldHint }
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
