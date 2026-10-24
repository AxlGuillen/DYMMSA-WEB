/**
 * Spanish tokens for the closed sets the assistant sees (#155 C6, ADR-041 §7): the SAME token goes in and out, and the
 * map to the DB value lives next to each domain constant. Client-safe: no imports.
 */

export interface TokenMap<K extends string, V extends string = string> {
  /** Every token, in the order of the map: the z.enum of the tools. */
  readonly tokens: readonly [V, ...V[]]
  /** DB value to token. */
  toToken(db: K): V
  /** Token to DB value; undefined for anything that is not one of them. */
  toDb(token: string): K | undefined
}

export function tokenMap<const T extends Readonly<Record<string, string>>>(map: T): TokenMap<keyof T & string, T[keyof T]> {
  type K = keyof T & string
  const entries = Object.entries(map) as [K, T[K]][]
  const tokens = entries.map(([, token]) => token) as [T[K], ...T[K][]]
  const byToken = new Map<string, K>(entries.map(([db, token]) => [token, db]))
  if (byToken.size !== entries.length) throw new Error('tokenMap: two values share a token')
  return {
    tokens,
    toToken: (db) => map[db],
    toDb: (token) => byToken.get(token),
  }
}

/** is_approved: null = the customer has not decided (#155 C6). */
export function approvalToken(value: boolean | null | undefined): 'pendiente' | 'aprobada' | 'rechazada' {
  return value === true ? 'aprobada' : value === false ? 'rechazada' : 'pendiente'
}

/** is_sold: null = undefined, false = "no lo vendemos" (#155 C6). */
export function soldToken(value: boolean | null | undefined): 'sin_definir' | 'si' | 'no' {
  return value === true ? 'si' : value === false ? 'no' : 'sin_definir'
}
