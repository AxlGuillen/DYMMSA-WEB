/**
 * Manifest types and the budget (#118, ADR-034). The entries themselves come from each tool's
 * defineTool docs (#155 A3): src/lib/mcp/catalog.ts builds them for the docs page and the consent screen.
 */

export type ToolBlock = 'app' | 'odoo'
export type ToolKind = 'read' | 'write'

export interface ToolManifestEntry {
  name: string
  block: ToolBlock
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
}

export type McpRole = 'admin' | 'member'

/**
 * Budget every tool must fit in (#133, ADR-034). Raising a cap is an explicit decision in the
 * PR, with its why: each new tool has to earn its place or replace another.
 */
export const TOOL_BUDGET = {
  /** Odoo 16 → 20 for the four #144 writes (ADR-040, decided 2026-10-16). */
  tools: { app: 36, odoo: 20 },
  /** Characters of description per tool; the exceptions carry a guide the model needs in full. */
  description: 1000,
  descriptionExceptions: { record_payroll_hours: 2600 } as Record<string, number>,
  /** 18,000 → 18,500 for the #134 writes (ADR-037); → 20,000 for the four Odoo tools of #144 (ADR-040). */
  descriptionsTotal: 20_000,
  /** Characters of the admin's tools/list on the wire, every field included (#155 A1). The 47,000 of #144 measured a proxy
   *  without annotations or JSON structure; on the wire the same list is 53,163, and 54,000 leaves ~1.6% of slack. */
  listTotal: 54_000,
  /** Characters of the server instructions, per role. 7,500 → 8,000 for the admin's Odoo write flow (#144). */
  instructions: 8000,
} as const

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
