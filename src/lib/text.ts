/** Strips characters that break PostgREST's `.or()` filter syntax. */
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%]/g, ' ').trim()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Tools accept "a UUID or a name": this decides which lookup runs. */
export const isUuid = (value: string) => UUID_RE.test(value)

/** Accent- and case-insensitive name matching for the name lookups. */
export const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
