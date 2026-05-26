/**
 * Mock del cliente de Supabase para tests unitarios de route handlers.
 *
 * Reproduce el query builder chainable de @supabase/supabase-js lo justo
 * para los handlers de DYMMSA:
 *
 *   supabase.from(t).insert(x).select().single()   → { data, error }
 *   supabase.from(t).select(c).eq(k, v).single()    → { data, error }
 *   supabase.from(t).update(x).eq(k, v)             → { data, error } (awaitable)
 *   supabase.from(t).delete().eq(k, v)              → { data, error } (awaitable)
 *   supabase.auth.getUser()                          → { data: { user } }
 *
 * El builder es a la vez chainable (cada filtro retorna `this`) y thenable
 * (implementa `.then()`), de modo que `await` resuelve la respuesta tanto si
 * se llamó `.single()` como si se await-ea el builder directamente.
 *
 * Las respuestas se configuran por `tabla` o `tabla.operacion`
 * (insert | select | update | delete | upsert). Todas las llamadas quedan
 * registradas en `_calls` para hacer assertions (rollback, deducción de stock, etc.).
 */

export type MockResult = { data?: unknown; error?: unknown }
export type ResponseValue = MockResult | ((rec: CallRecord) => MockResult)

export type Op = 'insert' | 'select' | 'update' | 'delete' | 'upsert'

export interface CallRecord {
  table: string
  op: Op
  /** Argumento pasado a insert/update/upsert. */
  payload?: unknown
  /** Filtros encadenados: eq/in/order/etc. con sus argumentos. */
  filters: Array<{ method: string; args: unknown[] }>
  /** true si se llamó .single() o .maybeSingle(). */
  single: boolean
}

export interface MockConfig {
  /** Usuario autenticado. `null` → no autenticado (auth.getUser devuelve user: null). */
  user?: { id: string } | null
  /** Respuestas por `tabla` o `tabla.op`. Si no hay match → { data: null, error: null }. */
  responses?: Record<string, ResponseValue>
}

const DEFAULT_RESULT: MockResult = { data: null, error: null }

class QueryBuilder<R = MockResult> implements PromiseLike<R> {
  private record: CallRecord
  private opSet = false

  constructor(table: string, private client: MockSupabaseClient) {
    this.record = { table, op: 'select', filters: [], single: false }
  }

  // ── Operaciones que fijan el tipo ──────────────────────────────────
  insert(payload: unknown) { return this.setOp('insert', payload) }
  update(payload: unknown) { return this.setOp('update', payload) }
  upsert(payload: unknown) { return this.setOp('upsert', payload) }
  delete()                 { return this.setOp('delete') }

  /** select no sobrescribe un op ya fijado (ej. insert().select()). */
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

  // ── Filtros / modificadores chainable ──────────────────────────────
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
  order(...a: unknown[]) { return this.filter('order', a) }
  limit(...a: unknown[]) { return this.filter('limit', a) }
  range(...a: unknown[]) { return this.filter('range', a) }

  // ── Terminales ─────────────────────────────────────────────────────
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

export class MockSupabaseClient {
  _calls: CallRecord[] = []
  private responses: Record<string, ResponseValue>
  private user: { id: string } | null

  constructor(config: MockConfig = {}) {
    this.responses = config.responses ?? {}
    this.user = config.user ?? null
  }

  from(table: string) {
    return new QueryBuilder(table, this)
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

  // ── Helpers de assertion ───────────────────────────────────────────
  /** Todas las llamadas a una tabla (opcionalmente filtradas por op). */
  callsTo(table: string, op?: Op): CallRecord[] {
    return this._calls.filter(
      (c) => c.table === table && (op === undefined || c.op === op),
    )
  }
  /** ¿Se ejecutó al menos una operación `op` sobre `table`? */
  didCall(table: string, op: Op): boolean {
    return this.callsTo(table, op).length > 0
  }
}

export function createMockSupabase(config: MockConfig = {}): MockSupabaseClient {
  return new MockSupabaseClient(config)
}
