/**
 * Utilidades de formato puras: fechas, strings, archivos, números.
 *
 * Reglas de diseño:
 * - Sin side effects (no DOM, no fetch, no Date.now() inline — el reloj se inyecta vía parámetro).
 * - Determinísticas: misma entrada → misma salida.
 * - Trivialmente testables con Bun test.
 */

// ─── Fechas ────────────────────────────────────────────────────────────

/**
 * Formato relativo en español: "hace 5 min", "ayer", "hace 3 días", etc.
 * Para fechas > 30 días devuelve el formato corto "15 ene 2026".
 *
 * @param dateStr  ISO string o cualquier formato parseable por Date
 * @param now      Reloj inyectable para tests (default: ahora)
 */
export function formatRelative(dateStr: string, now: Date = new Date()): string {
  const diff  = now.getTime() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  <  2) return 'hace un momento'
  if (mins  < 60) return `hace ${mins} min`
  if (hours < 24) return `hace ${hours}h`
  if (days  === 1) return 'ayer'
  if (days  <  7) return `hace ${days} días`
  if (days  < 30) return `hace ${Math.floor(days / 7)} sem`
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

/**
 * Fecha absoluta larga en español: "15 de enero de 2026, 14:30"
 */
export function formatAbsolute(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Fecha ISO solo día: "2026-05-11"
 */
export function formatISODate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0]
}

// ─── Strings ───────────────────────────────────────────────────────────

/**
 * Normaliza string: trim + toLowerCase. Útil para comparaciones case-insensitive.
 */
export function normalizeString(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Reemplaza caracteres no alfanuméricos por `_` y pasa a minúsculas.
 * Pensado para nombres de archivo descargables.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
}

// ─── Números ───────────────────────────────────────────────────────────

/**
 * Parsea un valor a number; retorna null si es NaN, null o undefined.
 */
export function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = parseFloat(String(value))
  return isNaN(num) ? null : num
}

/**
 * Parsea un valor a integer; retorna null si es NaN, null o undefined.
 */
export function parseInteger(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = parseInt(String(value), 10)
  return isNaN(num) ? null : num
}
