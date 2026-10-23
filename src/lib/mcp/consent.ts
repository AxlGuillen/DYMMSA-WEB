/**
 * What the OAuth consent screen promises, generated from the manifest (#133): the list used to
 * be typed by hand and said the assistant could only create tasks.
 */

import { manifestForRole } from './catalog'
import { groupByModule, type McpRole } from './manifest'

export interface ConsentSummary {
  /** Modules the assistant can read, in manifest order. */
  reads: string[]
  /** Each app write with its limit, in manifest order. */
  writes: { title: string; limits: string }[]
  /** Odoo writes (#144, ADR-040): admin-only, so a member's screen still promises Odoo is read-only. */
  odooWrites: { title: string; limits: string }[]
}

export function consentSummary(role: McpRole): ConsentSummary {
  const tools = manifestForRole(role)
  return {
    reads: groupByModule(tools.filter((t) => t.block === 'app' && t.kind === 'read')).map((g) => g.module),
    writes: tools.filter((t) => t.block === 'app' && t.kind === 'write').map((t) => ({ title: t.title, limits: t.limits ?? '' })),
    odooWrites: tools.filter((t) => t.block === 'odoo' && t.kind === 'write').map((t) => ({ title: t.title, limits: t.limits ?? '' })),
  }
}
