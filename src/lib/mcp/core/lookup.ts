import { isUuid, sanitizeSearch } from '@/lib/text'
import type { Db } from './db'
import { refOf } from './envelope'
import { ToolError } from './errors'

/** Exactly one match or a ToolError that lists the candidates — the guard every name lookup shares (#109). */
export function requireSingleMatch<T>(matches: T[], label: (m: T) => string, what: string, query: string): T {
  if (matches.length === 0) throw new ToolError(`No hay ${what} que coincida con "${query}".`)
  if (matches.length > 1) {
    const shown = matches.slice(0, 5).map(label).join(', ')
    const count = matches.length > 5 ? 'más de 5' : String(matches.length)
    throw new ToolError(`Hay ${count} coincidencias (${shown}${matches.length > 5 ? ', …' : ''}) — repite con el nombre completo o con su ref.`)
  }
  return matches[0]
}

/** The first 8 hex characters of a UUID: what a list shows and every resolver accepts (#155 C6). */
export const REF_PATTERN = /^[0-9a-f]{8}$/i

export interface NamedLookup<T extends { id: string }> {
  table: string
  select: string
  /** «orden», «proveedor»: how the messages call it. */
  what: string
  article: 'la' | 'el'
  /** How a candidate reads when several match; its ref is added. */
  label: (row: T) => string
  /** The name search: ilike over these columns, unless `search` says otherwise. */
  nameColumns?: readonly string[]
  search?: (db: Db, query: string) => Promise<T[]>
  /** When nothing matches the name; the default says «No hay X que coincida con "q"». */
  notFound?: (query: string) => string
}

/** A UUID's ref as a range over the uuid itself: PostgREST cannot cast in a filter, and uuids sort bytewise. */
function refRange(ref: string) {
  const head = ref.toLowerCase()
  return { from: `${head}-0000-0000-0000-000000000000`, to: `${head}-ffff-ffff-ffff-ffffffffffff` }
}

/**
 * One row by UUID, by ref (the first 8 hex) or by name — the lookup every get_*, save_* and delete_record shares
 * (#155 C6, ADR-041 §3). Several matches are an error with up to 5 candidates and their ref.
 */
export async function resolveByName<T extends { id: string }>(db: Db, lookup: NamedLookup<T>, input: string): Promise<T> {
  const raw = input.trim()
  const { what, article } = lookup
  if (!raw) throw new ToolError(`Indica ${article} ${what} (nombre o ref).`)
  const label = (row: T) => `${lookup.label(row)} [ref ${isUuid(row.id) ? refOf(row.id) : row.id.slice(0, 8)}]`

  if (isUuid(raw)) {
    const { data, error } = await db.from(lookup.table).select(lookup.select).eq('id', raw).maybeSingle()
    if (error) throw new ToolError(`Error al buscar ${article} ${what}: ${error.message}`)
    if (!data) throw new ToolError(`No encontré ${article} ${what} con ese id.`)
    return data as unknown as T
  }

  if (REF_PATTERN.test(raw)) {
    const { from, to } = refRange(raw)
    const { data, error } = await db.from(lookup.table).select(lookup.select).gte('id', from).lte('id', to).limit(6)
    if (error) throw new ToolError(`Error al buscar ${article} ${what}: ${error.message}`)
    const rows = (data ?? []) as unknown as T[]
    // A name can look like a ref: only a hit settles it, otherwise it is searched as a name.
    if (rows.length > 0) return requireSingleMatch(rows, label, what, raw)
  }

  const query = sanitizeSearch(raw)
  if (!query) throw new ToolError(`Indica ${article} ${what} (nombre o ref).`)
  let rows: T[]
  if (lookup.search) rows = await lookup.search(db, query)
  else {
    const columns = lookup.nameColumns ?? ['name']
    const { data, error } = await db
      .from(lookup.table)
      .select(lookup.select)
      .or(columns.map((column) => `${column}.ilike.%${query}%`).join(','))
      .limit(6)
    if (error) throw new ToolError(`Error al buscar ${article} ${what}: ${error.message}`)
    rows = (data ?? []) as unknown as T[]
  }
  if (rows.length === 0 && lookup.notFound) throw new ToolError(lookup.notFound(query))
  return requireSingleMatch(rows, label, what, query)
}
