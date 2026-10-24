/**
 * Supabase mock: the builder is chainable AND thenable, so `await` resolves with or without
 * `.single()`. Responses keyed by `table` or `table.op`; `.throwOnError()`/`storage.*` not modeled.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type MockResult = { data?: unknown; error?: unknown; count?: number }
export type ResponseValue = MockResult | ((rec: CallRecord) => MockResult)

export type Op = 'insert' | 'select' | 'update' | 'delete' | 'upsert'

export interface CallRecord {
  table: string
  op: Op
  /** Argument passed to insert/update/upsert. */
  payload?: unknown
  /** Second upsert argument (e.g. { onConflict }). */
  options?: unknown
  /** Chained filters: eq/in/order/etc. with their args. */
  filters: Array<{ method: string; args: unknown[] }>
  /** True if .single() or .maybeSingle() was called. */
  single: boolean
  /** Column list passed to .select(), if any. */
  columns?: string
}

export interface MockConfig {
  /** Authenticated user; `null` → unauthenticated. */
  user?: { id: string } | null
  /** Responses by `table` or `table.op`; no match → { data: null, error: null }. */
  responses?: Record<string, ResponseValue>
}

const DEFAULT_RESULT: MockResult = { data: null, error: null }

// Selects on these tables are checked against supabase/schema.sql: an unchecked mock
// let a nonexistent `quotations.quotation_number` reach production (cut-candidates).
const SCHEMA_CHECKED_TABLES = new Set(['quotations'])
let schemaColumns: Map<string, Set<string>> | null = null

/** Columns per table from schema.sql (CREATE TABLE bodies + ALTER TABLE ... ADD COLUMN). */
function loadSchemaColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>()
  const add = (table: string, column: string) => {
    if (!tables.has(table)) tables.set(table, new Set())
    tables.get(table)!.add(column)
  }
  let creating: string | null = null
  let altering: string | null = null
  const schema = readFileSync(join(process.cwd(), 'supabase/schema.sql'), 'utf8')
  for (const raw of schema.split(/\r?\n/)) {
    const line = raw.replace(/--.*$/, '').trim()
    const create = /^CREATE TABLE (?:public\.)?(\w+) \($/i.exec(line)
    if (create) { creating = create[1]; continue }
    if (creating) {
      // A bare `)` can close a multi-line CHECK; only `);` ends the table.
      if (line.startsWith(')') && line.endsWith(';')) creating = null
      else {
        const column = /^(\w+)\s/.exec(line)?.[1]
        if (column && !/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)$/i.test(column)) add(creating, column)
      }
      continue
    }
    const alter = /^ALTER TABLE (?:ONLY )?(?:public\.)?(\w+)/i.exec(line)
    if (alter) altering = alter[1]
    const added = /\bADD COLUMN (?:IF NOT EXISTS )?(\w+)/i.exec(line)?.[1]
    if (altering && added) add(altering, added)
    if (line.endsWith(';')) altering = null
  }
  return tables
}

/** Plain top-level columns of a select string; `*`, embeds and aggregates are skipped. */
export function selectedColumns(select: string): string[] {
  const tokens: string[] = []
  let depth = 0
  let current = ''
  for (const ch of select) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { tokens.push(current); current = '' }
    else current += ch
  }
  tokens.push(current)
  return tokens
    .map((token) => token.trim())
    .filter((token) => token && token !== '*' && !token.includes('('))
    .map((token) => {
      const noCast = token.split('::')[0].split('->')[0]
      return noCast.slice(noCast.indexOf(':') + 1).trim()
    })
    .filter((column) => /^\w+$/.test(column))
}

/** First selected column that the table does not have, as PostgREST would reject it. */
function unknownColumn(rec: CallRecord): string | undefined {
  if (!rec.columns || !SCHEMA_CHECKED_TABLES.has(rec.table)) return undefined
  schemaColumns ??= loadSchemaColumns()
  const known = schemaColumns.get(rec.table)
  if (!known?.size) throw new Error(`supabase-mock: no se encontraron columnas de ${rec.table} en supabase/schema.sql`)
  return selectedColumns(rec.columns).find((column) => !known.has(column))
}

class QueryBuilder<R = MockResult> implements PromiseLike<R> {
  private record: CallRecord
  private opSet = false

  constructor(table: string, private client: MockSupabaseClient) {
    this.record = { table, op: 'select', filters: [], single: false }
  }

  insert(payload: unknown) { return this.setOp('insert', payload) }
  update(payload: unknown) { return this.setOp('update', payload) }
  upsert(payload: unknown, options?: unknown) {
    this.record.options = options
    return this.setOp('upsert', payload)
  }
  delete()                 { return this.setOp('delete') }

  /** select never overwrites an op already set (e.g. insert().select()). */
  select(columns?: string) {
    if (!this.opSet) this.record.op = 'select'
    if (columns !== undefined) this.record.columns = columns
    return this
  }

  private setOp(op: Op, payload?: unknown) {
    this.record.op = op
    this.opSet = true
    if (payload !== undefined) this.record.payload = payload
    return this
  }

  private filter(method: string, args: unknown[]) {
    this.record.filters.push({ method, args })
    return this
  }
  eq(...a: unknown[])    { return this.filter('eq', a) }
  neq(...a: unknown[])   { return this.filter('neq', a) }
  in(...a: unknown[])    { return this.filter('in', a) }
  gt(...a: unknown[])    { return this.filter('gt', a) }
  gte(...a: unknown[])   { return this.filter('gte', a) }
  lt(...a: unknown[])    { return this.filter('lt', a) }
  lte(...a: unknown[])   { return this.filter('lte', a) }
  not(...a: unknown[])   { return this.filter('not', a) }
  is(...a: unknown[])    { return this.filter('is', a) }
  like(...a: unknown[])  { return this.filter('like', a) }
  ilike(...a: unknown[]) { return this.filter('ilike', a) }
  or(...a: unknown[])    { return this.filter('or', a) }
  order(...a: unknown[]) { return this.filter('order', a) }
  limit(...a: unknown[]) { return this.filter('limit', a) }
  range(...a: unknown[]) { return this.filter('range', a) }
  abortSignal(...a: unknown[]) { return this.filter('abortSignal', a) }

  single(): Promise<R>      { this.record.single = true; return this.resolve() }
  maybeSingle(): Promise<R> { this.record.single = true; return this.resolve() }

  then<T1 = R, T2 = never>(
    onfulfilled?: ((value: R) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return this.resolve().then(onfulfilled, onrejected)
  }

  private resolve(): Promise<R> {
    this.client._calls.push(this.record)
    return Promise.resolve(this.client._lookup(this.record) as R)
  }
}

export interface RpcCall {
  fn: string
  params?: unknown
}

export class MockSupabaseClient {
  _calls: CallRecord[] = []
  _rpcCalls: RpcCall[] = []
  private responses: Record<string, ResponseValue>
  private user: { id: string } | null

  constructor(config: MockConfig = {}) {
    this.responses = config.responses ?? {}
    this.user = config.user ?? null
  }

  from(table: string) {
    return new QueryBuilder(table, this)
  }

  /** Simple RPC: no chained filters; resolves `responses['rpc.<fn>']` (a function gets the params as `payload`). */
  rpc(fn: string, params?: unknown): Promise<MockResult> {
    this._rpcCalls.push({ fn, params })
    const v = this.responses[`rpc.${fn}`]
    if (v === undefined) return Promise.resolve(DEFAULT_RESULT)
    return Promise.resolve(
      typeof v === 'function' ? v({ table: fn, op: 'select', filters: [], single: false, payload: params }) : v,
    )
  }

  /** Params of every call to `fn`, in order. */
  rpcParams<T = Record<string, unknown>>(fn: string): T[] {
    return this._rpcCalls.filter((c) => c.fn === fn).map((c) => c.params as T)
  }

  auth = {
    getUser: async () => ({ data: { user: this.user }, error: null }),
  }

  _lookup(rec: CallRecord): MockResult {
    const unknown = unknownColumn(rec)
    if (unknown) {
      return { data: null, error: { code: '42703', message: `column ${rec.table}.${unknown} does not exist` } }
    }
    const v =
      this.responses[`${rec.table}.${rec.op}`] ?? this.responses[rec.table]
    if (v === undefined) return DEFAULT_RESULT
    return typeof v === 'function' ? v(rec) : v
  }

  /** All calls to a table, optionally filtered by op. */
  callsTo(table: string, op?: Op): CallRecord[] {
    return this._calls.filter(
      (c) => c.table === table && (op === undefined || c.op === op),
    )
  }
  /** Did at least one `op` run on `table`? */
  didCall(table: string, op: Op): boolean {
    return this.callsTo(table, op).length > 0
  }
  /** Payload of the first insert to `table` (rows by default). */
  insertPayload<T = Record<string, unknown>[]>(table: string): T {
    return this.callsTo(table, 'insert')[0]?.payload as T
  }
  /** Payload of the first update to `table` (a single row by default). */
  updatePayload<T = Record<string, unknown>>(table: string): T {
    return this.callsTo(table, 'update')[0]?.payload as T
  }
  /** Payload of the first upsert to `table` (rows by default). */
  upsertPayload<T = Record<string, unknown>[]>(table: string): T {
    return this.callsTo(table, 'upsert')[0]?.payload as T
  }
}

export function createMockSupabase(config: MockConfig = {}): MockSupabaseClient {
  return new MockSupabaseClient(config)
}

// Match filters by column, not position: survives a handler reordering its
// `.eq()` or adding an extra `.order()`.

/** Finds a chained filter by column (and method, default 'eq'). */
export function findFilter(rec: CallRecord, column: string, method = 'eq') {
  return rec.filters.find((f) => f.method === method && f.args[0] === column)
}
/** Did the record filter by `column` (method default 'eq')? */
export function hasFilter(rec: CallRecord, column: string, method = 'eq'): boolean {
  return findFilter(rec, column, method) !== undefined
}
/** Value of the filter on `column` (second arg of eq/in/etc.). */
export function filterValue(rec: CallRecord, column: string, method = 'eq'): unknown {
  return findFilter(rec, column, method)?.args[1]
}
