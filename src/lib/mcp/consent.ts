/**
 * What the OAuth consent screen promises, generated from the manifest (#133): the list used to
 * be typed by hand and said the assistant could only create tasks.
 */

import { manifestForRole } from './catalog'
import type { ConnectorId } from './core/define'
import { MCP_PATH, ODOO_MCP_PATH, CONNECTOR_NAMES } from './core/routes'
import { groupByModule, type McpRole } from './manifest'

export interface ConsentWrite {
  title: string
  limits: string
}

export interface ConsentConnector {
  name: string
  path: string
  /** Modules it can read, in manifest order. */
  reads: string[]
  /** Each write with its limit, in manifest order. */
  writes: ConsentWrite[]
}

/**
 * Both connectors, always: the token is shared (ADR-041 §1), so the screen cannot know which one is
 * being authorized. Odoo's writes are admin-only (ADR-040): a member's list is empty.
 */
export type ConsentSummary = Record<ConnectorId, ConsentConnector>

export function consentSummary(role: McpRole): ConsentSummary {
  const tools = manifestForRole(role)
  const connector = (id: ConnectorId, name: string, path: string): ConsentConnector => ({
    name,
    path,
    reads: groupByModule(tools.filter((t) => t.connector === id && t.kind === 'read')).map((g) => g.module),
    writes: tools.filter((t) => t.connector === id && t.kind === 'write').map((t) => ({ title: t.title, limits: t.limits ?? '' })),
  })
  return {
    dymmsa: connector('dymmsa', CONNECTOR_NAMES.dymmsa, MCP_PATH),
    odoo: connector('odoo', CONNECTOR_NAMES.odoo, ODOO_MCP_PATH),
  }
}
