/**
 * The assistant's catalog for the docs page and the consent screen (#118, #133), from both connectors' definitions
 * (`connector` = which one serves it, #155 B3, C6). Server-only: the docs page receives it as a prop.
 */

import type { McpRole, ToolManifestEntry } from './manifest'
import type { ConnectorId, ToolDefinition } from './core/define'
import { DYMMSA_TOOLS } from './connectors/dymmsa'
import { ODOO_TOOLS } from './connectors/odoo'

export function manifestEntryOf(tool: ToolDefinition): ToolManifestEntry {
  return {
    name: tool.name,
    connector: tool.connector,
    module: tool.docs.module,
    kind: tool.kind,
    title: tool.docs.title,
    example: tool.docs.example,
    ...(tool.docs.limits ? { limits: tool.docs.limits } : {}),
    ...(tool.adminOnly ? { adminOnly: true as const } : {}),
  }
}

export const TOOL_MANIFEST: readonly ToolManifestEntry[] = [...DYMMSA_TOOLS, ...ODOO_TOOLS].map(manifestEntryOf)

export const manifestFor = (connector: ConnectorId) => TOOL_MANIFEST.filter((t) => t.connector === connector)

/** What a caller of this role gets registered (#133): a member never sees the admin-only tools. */
export const manifestForRole = (role: McpRole) =>
  role === 'admin' ? TOOL_MANIFEST : TOOL_MANIFEST.filter((t) => !t.adminOnly)

export const ADMIN_ONLY_TOOLS: ReadonlySet<string> = new Set(TOOL_MANIFEST.filter((t) => t.adminOnly).map((t) => t.name))

/** What the docs page shows: everything except the admin-only modules. */
export const DOCS_MANIFEST: readonly ToolManifestEntry[] = manifestForRole('member')
