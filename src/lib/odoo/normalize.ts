/**
 * Normalización de respuestas de Odoo → JSON digerido para el LLM (ADR-025).
 *
 * Odoo crudo es incómodo para un modelo: many2one como `[id, "nombre"]`,
 * `false` donde cualquier API diría null, y ruido interno (`__domain`) en los
 * agregados. La regla del bloque: el server normaliza y resume; el modelo
 * interpreta — nunca recibe registros crudos.
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

/**
 * Limpia los grupos de read_group: quita `__domain`/`__range` y renombra
 * `<campo>_count` a `count`.
 */
export function normalizeGroups(groups: unknown): OdooRecord[] {
  if (!Array.isArray(groups)) return []
  return groups.map((raw) => {
    const out: OdooRecord = {}
    for (const [key, value] of Object.entries(raw as OdooRecord)) {
      if (key.startsWith('__')) continue
      if (key.endsWith('_count')) {
        out.count = value
        continue
      }
      out[key] = normalizeValue(value)
    }
    return out
  })
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
