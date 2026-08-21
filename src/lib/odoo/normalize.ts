/**
 * Odoo crudo → JSON digerido: many2one → nombre, false → null, __* fuera.
 * Regla del bloque: el server digiere, el modelo interpreta (ADR-025).
 */

type OdooRecord = Record<string, unknown>

function normalizeValue(value: unknown): unknown {
  // many2one: [id, "nombre legible"] → el nombre (el id interno no le sirve al LLM)
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'string') {
    return value[1]
  }
  // Odoo devuelve `false` para escalares vacíos
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

/** Limpia read_group (quita __*, renombra a count) y descarta count=0: Odoo devuelve todas las opciones del selection. */
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

/** Días transcurridos desde `dateIso` (YYYY-MM-DD) hasta hoy; 0 si es futura. */
export function daysSince(dateIso: string, today = new Date()): number {
  const date = new Date(`${dateIso}T00:00:00Z`)
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.max(0, Math.round((now - date.getTime()) / 86_400_000))
}

/** Fecha de hoy en formato de dominio Odoo (YYYY-MM-DD). */
export function todayIso(today = new Date()): string {
  return today.toISOString().slice(0, 10)
}
