/** Keys a view reads from a result's _meta; namespaced so they never collide with the protocol's. */
export type ResultMeta = Readonly<Record<`dymmsa/${string}`, string>>

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean; _meta?: ResultMeta }

declare const resultDataType: unique symbol

/** Opaque wrapper: only run() opens it, so its meta never lands in the text the model reads (#144). */
export interface ResultWithMeta<T> {
  readonly [resultDataType]?: T
  toJSON(): never
}

// Identity, not shape: an Odoo row that happens to carry `_meta` stays plain data.
const resultMeta = new WeakMap<object, { data: unknown; meta: ResultMeta }>()

export function withResultMeta<T>(data: T, meta: ResultMeta): ResultWithMeta<T> {
  const wrapper: ResultWithMeta<T> = Object.freeze({
    // Nested in other data it would be serialized: failing beats leaking or dropping the meta.
    toJSON(): never {
      throw new Error('withResultMeta() must be the tool result itself, never nested in other data')
    },
  })
  resultMeta.set(wrapper, { data, meta: Object.freeze({ ...meta }) })
  return wrapper
}

/** The tool's data and, only for a withResultMeta() result with keys, its meta. */
export function splitResultMeta<T>(value: T | ResultWithMeta<T>): { data: T; meta: ResultMeta | null } {
  const entry = typeof value === 'object' && value !== null ? resultMeta.get(value) : undefined
  if (!entry) return { data: value as T, meta: null }
  return { data: entry.data as T, meta: Object.keys(entry.meta).length > 0 ? entry.meta : null }
}
