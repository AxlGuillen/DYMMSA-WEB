import { NextRequest, NextResponse } from 'next/server'
import { nextMonth, payableTotals, resolvePayableFilter } from '@/lib/payables'
import { createPayable } from '@/lib/payables-store'
import { createClient } from '@/lib/supabase/server'
import { todayInMexico } from '@/lib/format'
import { requireAuth, requireRole, apiError, badRequest, serverError, isUuid } from '@/lib/api-helpers'
import type { Payable, PayableWithSupplier } from '@/types/database'

const SORT_FIELDS = ['due_date', 'invoice_date', 'amount', 'created_at'] as const
type SortField = (typeof SORT_FIELDS)[number]


/** Neutralizes PostgREST metacharacters before interpolating into .or()/.ilike(). */
const sanitizeSearch = (raw: string) => raw.replace(/[,()%]/g, ' ').trim()

const ISO_MONTH = /^\d{4}-\d{2}$/

/** Rows summed for the footer total; `truncated` compares what arrived, since PostgREST max_rows may cut first. */
const TOTALS_LIMIT = 5000
const LIST_COLUMNS = '*, supplier:suppliers(id, name, payment_terms_days)'
const TOTAL_COLUMNS = 'amount, currency'

/** Optional non-negative amount from the query; `undefined` when absent, `null` when invalid. */
function amountParam(raw: string | null): number | null | undefined {
  if (raw === null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Latest "marked paid" event per payable, from the admin-only audit trail. Called ONLY for an
 * admin: a member's response must not even carry the key (ADR-028).
 */
async function paidByFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Map<string, PayableWithSupplier['paid_by']>> {
  const out = new Map<string, PayableWithSupplier['paid_by']>()
  if (ids.length === 0) return out
  const { data, error } = await supabase
    .from('audit_events')
    .select('entity_id, actor_name, created_at')
    .eq('entity_type', 'payable')
    .eq('action', 'status_changed')
    .eq('data->to->>status', 'paid')
    .in('entity_id', ids)
    .order('created_at', { ascending: false })
    // id breaks the tie: events written in one transaction share created_at.
    .order('id', { ascending: false })
  // The list still answers without the column; an empty trail must not look like "nobody".
  if (error) console.error('Error fetching payables audit trail:', error)
  for (const row of (data ?? []) as { entity_id: string; actor_name: string | null; created_at: string }[]) {
    if (!out.has(row.entity_id)) out.set(row.entity_id, { name: row.actor_name, at: row.created_at })
  }
  return out
}

// GET /api/payables — paginated list with the supplier embedded
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireRole(supabase)
    if ('error' in auth) return auth.error
    const isAdmin = auth.profile?.role === 'admin'

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20))
    const search = sanitizeSearch(searchParams.get('search') ?? '')
    const status = searchParams.get('status') ?? ''
    const month = searchParams.get('month') ?? ''
    const supplier = searchParams.get('supplier') ?? ''
    const minAmount = amountParam(searchParams.get('minAmount'))
    const maxAmount = amountParam(searchParams.get('maxAmount'))
    if (minAmount === null || maxAmount === null) return badRequest('Monto inválido en el filtro')
    if (minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount) {
      return badRequest('El monto mínimo no puede superar al máximo')
    }
    const sortParam = searchParams.get('sortField') as SortField | null
    const sortField: SortField = sortParam && SORT_FIELDS.includes(sortParam) ? sortParam : 'due_date'
    const ascending = searchParams.get('sortDir') !== 'desc'

    const from = (page - 1) * pageSize
    const filter = resolvePayableFilter(status, todayInMexico())
    // One builder for the page and for the footer total: they must describe the same set.
    const filteredQuery = (columns: string, count?: 'exact') => {
      let q = supabase.from('payables').select(columns, count ? { count } : undefined)
      if (search) q = q.ilike('concept', `%${search}%`)
      if (filter) q = q.eq('status', filter.status)
      if (filter?.dueBefore) q = q.lt('due_date', filter.dueBefore)
      if (isUuid(supplier)) q = q.eq('supplier_id', supplier)
      if (minAmount !== undefined) q = q.gte('amount', minAmount)
      if (maxAmount !== undefined) q = q.lte('amount', maxAmount)
      // Filter by DUE month — the criterion the overview and the planning use.
      if (ISO_MONTH.test(month)) q = q.gte('due_date', `${month}-01`).lt('due_date', nextMonth(month))
      return q
    }

    const [pageRes, totalsRes] = await Promise.all([
      filteredQuery(LIST_COLUMNS, 'exact')
        .order(sortField, { ascending, nullsFirst: false })
        .range(from, from + pageSize - 1),
      filteredQuery(TOTAL_COLUMNS).limit(TOTALS_LIMIT),
    ])
    const { data, error, count } = pageRes

    if (error || totalsRes.error) {
      console.error('Error fetching payables:', error ?? totalsRes.error)
      return serverError('Error al obtener las facturas por pagar')
    }

    let rows = (data ?? []) as unknown as PayableWithSupplier[]
    if (isAdmin) {
      // Only rows that are paid NOW: a payable sent back to pending keeps its old event.
      const paidIds = rows.filter((r) => r.status === 'paid').map((r) => r.id)
      const paidBy = await paidByFor(supabase, paidIds)
      rows = rows.map((r) => ({ ...r, paid_by: r.status === 'paid' ? paidBy.get(r.id) ?? null : null }))
    }

    return NextResponse.json({
      data: rows,
      count: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
      // Every filtered row, not just this page (2026-10-20).
      totals: {
        ...payableTotals((totalsRes.data ?? []) as unknown as Pick<Payable, 'amount' | 'currency'>[]),
        truncated: (totalsRes.data?.length ?? 0) < (count ?? 0),
      },
    })
  } catch (error) {
    console.error('Payables GET error:', error)
    return serverError('Error al obtener las facturas por pagar')
  }
}

// POST /api/payables — supplier is required and must exist in the catalog
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    return NextResponse.json(await createPayable(supabase, await request.json()), { status: 201 })
  } catch (error) {
    return apiError(error, 'Error al registrar la factura', 'Payables POST error:')
  }
}
