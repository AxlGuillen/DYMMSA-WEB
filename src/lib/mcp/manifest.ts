/**
 * Manifest types and the budget (#118, ADR-034). The entries themselves come from each tool's
 * defineTool docs (#155 A3): src/lib/mcp/catalog.ts builds them for the docs page and the consent screen.
 */

import type { ConnectorId } from './core/define'
export type ToolKind = 'read' | 'write'

export interface ToolManifestEntry {
  name: string
  connector: ConnectorId
  /** Group shown in the docs (one per screen/module). */
  module: string
  kind: ToolKind
  title: string
  /** A question the user could ask that lands on this tool. */
  example: string
  /** Writes only: what the tool will never do. */
  limits?: string
  /**
   * Admin-only tool (#133): not registered for a member, not in the in-app docs every member
   * reads. The RLS is still the barrier; this only trims the list the model sees.
   */
  adminOnly?: true
  /** Writes only the user's yes (two phases with a key): the docs say so (#155 C4). */
  confirm?: 'two_phase'
}

export type McpRole = 'admin' | 'member'

/**
 * Per-tool caps both connectors share (#133, ADR-034). Raising a cap is an explicit decision in the
 * PR, with its why: each new tool has to earn its place or replace another.
 */
export const TOOL_BUDGET = {
  /** Characters of description per tool; the exceptions carry a guide the model needs in full. */
  description: 1000,
  descriptionExceptions: { save_payroll_hours: 2600 } as Record<string, number>,
} as const

/**
 * Caps of one connector (ADR-041 § Presupuestos), next to its definition: DYMMSA_BUDGET and ODOO_BUDGET.
 * tools/list is the admin's, on the wire with every field (#155 A1); instructions are per role.
 */
export interface ConnectorBudget {
  tools: number
  listTotal: number
  descriptionsTotal: number
  instructions: number
}

/** Entries grouped by module, in first-appearance order. */
export function groupByModule(entries: readonly ToolManifestEntry[]): { module: string; tools: ToolManifestEntry[] }[] {
  const groups = new Map<string, ToolManifestEntry[]>()
  for (const entry of entries) {
    const list = groups.get(entry.module) ?? []
    list.push(entry)
    groups.set(entry.module, list)
  }
  return [...groups.entries()].map(([module, tools]) => ({ module, tools }))
}
