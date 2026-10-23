/**
 * The assistant's catalog for the docs page and the consent screen (#118, #133). Server-only: it pulls
 * the tool definitions, so the docs page receives it as a prop instead of importing it on the client.
 */

import { APP_MANIFEST, type McpRole, type ToolBlock, type ToolManifestEntry } from './manifest'
import type { ToolDefinition } from './core/define'
import { ODOO_TOOLS } from './connectors/odoo'

export function manifestEntryOf(tool: ToolDefinition): ToolManifestEntry {
  return {
    name: tool.name,
    block: tool.connector === 'odoo' ? 'odoo' : 'app',
    module: tool.docs.module,
    kind: tool.kind,
    title: tool.docs.title,
    example: tool.docs.example,
    ...(tool.docs.limits ? { limits: tool.docs.limits } : {}),
    ...(tool.adminOnly ? { adminOnly: true as const } : {}),
  }
}

export const TOOL_MANIFEST: readonly ToolManifestEntry[] = [...APP_MANIFEST, ...ODOO_TOOLS.map(manifestEntryOf)]

export const manifestFor = (block: ToolBlock) => TOOL_MANIFEST.filter((t) => t.block === block)

/** What a caller of this role gets registered (#133): a member never sees the admin-only tools. */
export const manifestForRole = (role: McpRole) =>
  role === 'admin' ? TOOL_MANIFEST : TOOL_MANIFEST.filter((t) => !t.adminOnly)

export const ADMIN_ONLY_TOOLS: ReadonlySet<string> = new Set(TOOL_MANIFEST.filter((t) => t.adminOnly).map((t) => t.name))

/** What the docs page shows: everything except the admin-only modules. */
export const DOCS_MANIFEST: readonly ToolManifestEntry[] = manifestForRole('member')
