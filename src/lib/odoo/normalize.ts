/** Raw Odoo → digested JSON. Block rule: the server digests, the model interprets (ADR-025). */

import { todayInMexico } from '@/lib/format'

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

/** Raw x2many (id array) → number[]; anything else is dropped so it never reaches a domain. */
export function idsOf(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : []
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }

/** Odoo html fields (`narration`) → plain text; block tags become line breaks. Empty → null. */
export function htmlToText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  return text || null
}

/** Days elapsed since `dateIso` up to today in Morelia; 0 when it is in the future. */
export function daysSince(dateIso: string, today = new Date()): number {
  const date = Date.parse(`${dateIso}T00:00:00Z`)
  const now = Date.parse(`${todayInMexico(today)}T00:00:00Z`)
  return Math.max(0, Math.round((now - date) / 86_400_000))
}

/** Today (YYYY-MM-DD) on the business clock: UTC said "tomorrow" from 18:00, so the MCP and the
 *  income route disagreed on what was overdue (PR #99). */
export function todayIso(today = new Date()): string {
  return todayInMexico(today)
}
