/** Utilidades de formato puras y determinísticas — el reloj se inyecta por parámetro. */

// ─── Fechas ────────────────────────────────────────────────────────────

/** Fecha relativa en español ("hace 5 min", "ayer"); > 30 días → corto "15 ene 2026". */
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
 * Columna `date` ('2026-09-15') a "15 de septiembre de 2026". Se ancla y
 * formatea en UTC porque `new Date('2026-09-15')` es medianoche UTC y en
 * Morelia se pintaría el día anterior; una fecha sin hora no tiene zona.
 */
export function formatDayLong(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(`${iso}T00:00:00Z`))
}

/**
 * Fecha ISO solo día: "2026-05-11"
 */
export function formatISODate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0]
}

/**
 * Hoy en la zona del negocio (Morelia). `formatISODate` serializa en UTC y el
 * server corre en UTC: de las 18:00 a la medianoche local ya sería mañana.
 */
export function todayInMexico(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
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
