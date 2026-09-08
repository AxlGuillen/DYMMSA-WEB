/** Raw Odoo → digested JSON. Block rule: the server digests, the model interprets (ADR-025). */

type OdooRecord = Record<string, unknown>

function normalizeValue(value: unknown): unknown {
  // many2one: [id, "display name"] → the name; the internal id is useless to the model
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'string') {
    return value[1]
  }
  // Odoo returns `false` for empty scalars
  if (value === false) return null
  return value
}

export function normalizeRecord(record: OdooRecord): OdooRecord {
  const out: OdooRecord = {}
  for (const [key, value] of Object.entries(record)) {
    out[key] = normalizeValue(value)
  }
  return out
}

export function normalizeRecords(records: unknown): OdooRecord[] {
  if (!Array.isArray(records)) return []
  return records.map((r) => normalizeRecord(r as OdooRecord))
}

/** Drops count=0 groups: Odoo returns every option of a selection field. */
export function normalizeGroups(groups: unknown): OdooRecord[] {
  if (!Array.isArray(groups)) return []
  const out: OdooRecord[] = []
  for (const raw of groups) {
    const group: OdooRecord = {}
    for (const [key, value] of Object.entries(raw as OdooRecord)) {
      if (key.startsWith('__')) continue
      if (key.endsWith('_count')) {
        group.count = value
        continue
      }
      group[key] = normalizeValue(value)
    }
    if (group.count === 0) continue
    out.push(group)
  }
  return out
}

/** Days elapsed since `dateIso` up to today; 0 when it is in the future. */
export function daysSince(dateIso: string, today = new Date()): number {
  const date = new Date(`${dateIso}T00:00:00Z`)
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.max(0, Math.round((now - date.getTime()) / 86_400_000))
}

/** Today in Odoo domain format (YYYY-MM-DD). */
export function todayIso(today = new Date()): string {
  return today.toISOString().slice(0, 10)
}
