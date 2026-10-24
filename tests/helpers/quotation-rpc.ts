/**
 * In-memory stand-ins for the quotation functions of #157 (update_quotation, submit_quotation_approval),
 * same semantics as the SQL, so route tests assert the resulting lines instead of payloads. The real
 * functions run in tests/integration/quotation-update.integration.test.ts and approval.integration.test.ts.
 */

import { createMockSupabase, type MockResult, type MockSupabaseClient, type ResponseValue } from './supabase-mock'

export const Q_ID = '11111111-1111-4111-8111-111111111111'
export const TOKEN = '22222222-2222-4222-8222-222222222222'
/** Deterministic line ids: lineId(1) … lineId(n). */
export const lineId = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`

export interface FakeLine {
  id: string
  item_type: 'product' | 'separator'
  etm?: string | null
  model_code?: string | null
  brand?: string | null
  unit_price?: number | null
  quantity?: number | null
  delivery_time?: string | null
  section_label?: string | null
  separator_color?: string | null
  dymmsa_description?: string | null
  is_approved: boolean | null
  is_sold: boolean | null
  sort_order: number
  [column: string]: unknown
}

export interface FakeQuotation {
  id: string
  status: string
  approval_token: string
  approved_at: string | null
  name: string
  customer_name: string
  total_amount: number
}

interface Options {
  user?: { id: string } | null
  quotation?: Partial<FakeQuotation>
  lines?: Array<Partial<FakeLine>>
  responses?: Record<string, ResponseValue>
  /** Makes update_quotation fail as Postgres would (nothing changes: it is one transaction). */
  updateError?: { code?: string; message: string }
  /** Makes submit_quotation_approval fail with a non-rule error. */
  approvalError?: { code?: string; message: string }
}

const p0001 = (message: string): MockResult => ({ data: null, error: { code: 'P0001', message } })

/** Mock client whose quotation reads and RPCs share one state, like the DB. */
export function quotationDb(opts: Options = {}) {
  const quotation: FakeQuotation = {
    id: Q_ID, status: 'draft', approval_token: TOKEN, approved_at: null,
    name: 'COT-001', customer_name: 'ACME', total_amount: 0,
    ...opts.quotation,
  }
  let lines: FakeLine[] = (opts.lines ?? []).map((line, index) => ({
    id: lineId(index + 1), item_type: 'product', is_approved: null, is_sold: null, sort_order: index, ...line,
  }))
  let fresh = 0

  const eqFilters = (rec: { filters: Array<{ method: string; args: unknown[] }> }) =>
    rec.filters.filter((f) => f.method === 'eq').map((f) => [String(f.args[0]), f.args[1]] as const)

  const client: MockSupabaseClient = createMockSupabase({
    user: opts.user === undefined ? { id: 'user-1' } : opts.user,
    responses: {
      'quotations.select': (rec) => {
        const match = eqFilters(rec).every(([col, value]) => (quotation as unknown as Record<string, unknown>)[col] === value)
        return match ? { data: { ...quotation }, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
      },
      'quotation_items.select': (rec) => {
        const filters = eqFilters(rec).filter(([col]) => col !== 'quotation_id')
        return { data: lines.filter((l) => filters.every(([col, value]) => l[col] === value)).map((l) => ({ ...l })), error: null }
      },
      ...opts.responses,
    },
  })

  const updateQuotation = (params: Record<string, unknown>): MockResult => {
    if (params.p_quotation_id !== quotation.id) return p0001('quotation_not_found')
    if (!['draft', 'sent_for_approval', 'approved'].includes(quotation.status)) return p0001('quotation_not_editable')
    const items = params.p_items as Array<Record<string, unknown> & { id: string | null }>
    const ids = items.map((i) => i.id).filter((id): id is string => id != null)
    if (new Set(ids).size !== ids.length) return p0001('duplicate_item')
    if (opts.updateError) return { data: null, error: opts.updateError }

    const byId = new Map(lines.map((l) => [l.id, l]))
    const next: FakeLine[] = items.map((item, pos) => {
      const { id, ...columns } = item
      const existing = id ? byId.get(id) : undefined
      const isSep = columns.item_type === 'separator'
      const is_approved = isSep
        ? null
        : existing && quotation.status === 'sent_for_approval'
          ? existing.is_approved
          : ((columns.is_approved as boolean | null | undefined) ?? null)
      return {
        ...(existing ?? {}),
        ...(columns as Partial<FakeLine>),
        id: existing ? existing.id : `new-${++fresh}`,
        is_approved,
        sort_order: pos,
      } as FakeLine
    })
    const kept = new Set(next.map((l) => l.id))
    const deleted = lines.filter((l) => !kept.has(l.id)).length
    const updated = next.filter((l) => byId.has(l.id)).length
    lines = next
    const header = params.p_header as { name: string; customer_name: string; total_amount: number }
    Object.assign(quotation, header)
    return { data: { updated, inserted: next.length - updated, deleted }, error: null }
  }

  const submitApproval = (params: Record<string, unknown>): MockResult => {
    if (opts.approvalError) return { data: null, error: opts.approvalError }
    if (params.p_token !== quotation.approval_token) return p0001('quotation_not_found')
    if (quotation.status !== 'sent_for_approval') return p0001('quotation_processed')
    const ids = [...new Set(params.p_approved_ids as string[])]
    const approvable = (l: FakeLine) => l.item_type === 'product' && l.is_sold !== false
    const valid = lines.filter((l) => approvable(l) && ids.includes(l.id)).length
    if (valid !== ids.length) return p0001('stale_items')
    const finalize = params.p_finalize === true
    for (const line of lines) {
      if (!approvable(line)) continue
      line.is_approved = ids.includes(line.id) ? true : finalize ? false : null
    }
    if (!finalize) return { data: { finalized: false, status: quotation.status, approved_count: valid }, error: null }
    quotation.status = valid > 0 ? 'approved' : 'rejected'
    if (quotation.status === 'approved') quotation.approved_at ??= '2026-10-24T18:00:00.000Z'
    return { data: { finalized: true, status: quotation.status, approved_count: valid }, error: null }
  }

  // The stg mock does not pass params to rpc responses; this client owns its two functions.
  client.rpc = (fn: string, params?: unknown) => {
    client._rpcCalls.push({ fn, params })
    const args = (params ?? {}) as Record<string, unknown>
    if (fn === 'update_quotation') return Promise.resolve(updateQuotation(args))
    if (fn === 'submit_quotation_approval') return Promise.resolve(submitApproval(args))
    return Promise.resolve({ data: null, error: null })
  }

  return {
    client,
    quotation,
    /** Current lines in sort_order. */
    lines: () => [...lines].sort((a, b) => a.sort_order - b.sort_order),
    rpcParams: (fn: string) => client._rpcCalls.filter((c) => c.fn === fn).map((c) => c.params as Record<string, unknown>),
  }
}
