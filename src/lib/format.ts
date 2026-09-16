/** Pure deterministic formatting — the clock is always injected as a parameter. */

/** Relative Spanish date; past 30 days it falls back to a short absolute date. */
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

export function formatAbsolute(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/** Anchored and formatted in UTC: `new Date('2026-09-15')` is UTC midnight and would render the
 *  previous day in Morelia — a date without a time has no zone. */
export function formatDayLong(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(`${iso}T00:00:00Z`))
}

/** User-selectable `date` column formats (#92). */
export const DATE_FORMATS = ['long', 'short', 'dd-mm-yyyy', 'dd/mm/yyyy', 'yyyy-mm-dd'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]
export const DEFAULT_DATE_FORMAT: DateFormat = 'long'

export function isDateFormat(value: unknown): value is DateFormat {
  return typeof value === 'string' && (DATE_FORMATS as readonly string[]).includes(value)
}

/** Numeric formats are built from the string, never from `Date` — same zone trap as `formatDayLong`. */
export function formatDay(iso: string, format: DateFormat = DEFAULT_DATE_FORMAT): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [y, m, d] = iso.split('-')
  switch (format) {
    case 'dd-mm-yyyy': return `${d}-${m}-${y}`
    case 'dd/mm/yyyy': return `${d}/${m}/${y}`
    case 'yyyy-mm-dd': return iso
    case 'short':
      return new Intl.DateTimeFormat('es-MX', {
        timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
      }).format(new Date(`${iso}T00:00:00Z`))
    default:
      return formatDayLong(iso)
  }
}

export function formatISODate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0]
}

/** Today in the business timezone (Morelia): the server runs in UTC, so `formatISODate` would
 *  already say tomorrow between 18:00 and local midnight. */
export function todayInMexico(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

export function normalizeString(value: string): string {
  return value.trim().toLowerCase()
}

/** Non-alphanumerics → `_`, lowercased; for download filenames. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
}

export function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = parseFloat(String(value))
  return isNaN(num) ? null : num
}

export function parseInteger(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = parseInt(String(value), 10)
  return isNaN(num) ? null : num
}
