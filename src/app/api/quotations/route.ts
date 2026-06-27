import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, serverError } from '@/lib/api-helpers'
import type { Quotation, QuotationWithCount, QuotationStatus } from '@/types/database'

const STATUSES: QuotationStatus[] = [
  'draft',
  'sent_for_approval',
  'approved',
  'rejected',
  'converted_to_order',
]

/** Quita los caracteres que rompen la sintaxis del filtro `.or()` de PostgREST. */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%]/g, ' ').trim()
}

// GET /api/quotations?page=&pageSize=&search=&status=
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10) || 20))
    const search = sanitizeSearch(searchParams.get('search') ?? '')

    const statusParam = searchParams.get('status') ?? 'all'
    const status = STATUSES.includes(statusParam as QuotationStatus)
      ? (statusParam as QuotationStatus)
      : 'all'

    let query = supabase
      .from('quotations')
      .select('*, quotation_items(count)', { count: 'exact' })

    if (search) {
      query = query.or(`customer_name.ilike.%${search}%,name.ilike.%${search}%`)
    }
    if (status !== 'all') {
      query = query.eq('status', status)
    }

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) {
      console.error('Error listing quotations:', error)
      return serverError('Error al obtener las cotizaciones')
    }

    const mapped: QuotationWithCount[] = (data ?? []).map((q) => {
      const raw = q as Quotation & { quotation_items: [{ count: number }] | null }
      return { ...q, items_count: raw.quotation_items?.[0]?.count ?? 0 }
    })

    return NextResponse.json({
      data: mapped,
      count: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    })
  } catch (error) {
    console.error('Quotations list error:', error)
    return serverError('Error al obtener las cotizaciones')
  }
}
