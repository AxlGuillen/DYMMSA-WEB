/**
 * Supabase mock: the builder is chainable AND thenable, so `await` resolves with or without
 * `.single()`. Responses keyed by `table` or `table.op`; `.throwOnError()`/`storage.*` not modeled.
 */

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
}

export interface MockConfig {
  /** Authenticated user; `null` → unauthenticated. */
  user?: { id: string } | null
  /** Responses by `table` or `table.op`; no match → { data: null, error: null }. */
  responses?: Record<string, ResponseValue>
}

const DEFAULT_RESULT: MockResult = { data: null, error: null }

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
  select(_columns?: string) {
    if (!this.opSet) this.record.op = 'select'
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

  /** Simple RPC: no chained filters; resolves `responses['rpc.<fn>']`. */
  rpc(fn: string, params?: unknown): Promise<MockResult> {
    this._rpcCalls.push({ fn, params })
    const v = this.responses[`rpc.${fn}`]
    if (v === undefined) return Promise.resolve(DEFAULT_RESULT)
    return Promise.resolve(typeof v === 'function' ? v({ table: fn, op: 'select', filters: [], single: false }) : v)
  }

  auth = {
    getUser: async () => ({ data: { user: this.user }, error: null }),
  }

  _lookup(rec: CallRecord): MockResult {
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
