import { createHash } from 'node:crypto'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Keys sorted at every depth; undefined dropped as JSON does. */
export function canonicalJson(value: unknown): string {
  const sorted = (_key: string, v: unknown) =>
    isRecord(v) ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v
  return JSON.stringify(value, sorted) ?? 'null'
}

export const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

/** The hash of any JSON-able value, key order and undefined aside. */
export const hashOf = (value: unknown) => sha256Hex(canonicalJson(value))
