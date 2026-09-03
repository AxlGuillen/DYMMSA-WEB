import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, notFound, serverError } from '@/lib/api-helpers'
import type { PayableInsert, PayableStatus } from '@/types/database'

const SORT_FIELDS = ['due_date', 'invoice_date', 'amount', 'created_at'] as const
type SortField = (typeof SORT_FIELDS)[number]

const STATUSES: PayableStatus[] = ['pending', 'paid', 'cancelled']

/** Neutraliza los metacaracteres de PostgREST antes de interpolar en .or()/.ilike(). */
const sanitizeSearch = (raw: string) => raw.replace(/[,()%]/g, ' ').trim()

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_MONTH = /^\d{4}-\d{2}$/

// GET /api/payables → lista paginada con proveedor embebido
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20))
    const search = sanitizeSearch(searchParams.get('search') ?? '')
    const status = searchParams.get('status') ?? ''
    const month = searchParams.get('month') ?? ''
    const sortParam = searchParams.get('sortField') as SortField | null
    const sortField: SortField = sortParam && SORT_FIELDS.includes(sortParam) ? sortParam : 'due_date'
    const ascending = searchParams.get('sortDir') !== 'desc'

    const from = (page - 1) * pageSize
    let query = supabase
      .from('payables')
      .select('*, supplier:suppliers(id, name, payment_terms_days)', { count: 'exact' })

    if (search) query = query.ilike('concept', `%${search}%`)
    if (STATUSES.includes(status as PayableStatus)) query = query.eq('status', status)
    if (ISO_MONTH.test(month)) {
      // Mes de VENCIMIENTO — el criterio del overview y de la planeación.
      query = query.gte('due_date', `${month}-01`).lt('due_date', nextMonth(month))
    }

    const { data, error, count } = await query
      .order(sortField, { ascending, nullsFirst: false })
      .range(from, from + pageSize - 1)

    if (error) {
      console.error('Error fetching payables:', error)
      return serverError('Error al obtener las facturas por pagar')
    }

    return NextResponse.json({
      data: data ?? [],
      count: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    })
  } catch (error) {
    console.error('Payables GET error:', error)
    return serverError('Error al obtener las facturas por pagar')
  }
}

/** Primer día del mes siguiente a 'YYYY-MM' (frontera exclusiva del filtro). */
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

// POST /api/payables → capturar factura (proveedor obligatorio del catálogo)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as Partial<PayableInsert>

    const supplierId = typeof body.supplier_id === 'string' ? body.supplier_id : ''
    if (!supplierId) return badRequest('Elige el proveedor de la factura')

    const concept = typeof body.concept === 'string' ? body.concept.trim() : ''
    if (!concept) return badRequest('El concepto es obligatorio')

    const amount = typeof body.amount === 'number' ? body.amount : NaN
    if (!Number.isFinite(amount) || amount <= 0) return badRequest('El monto debe ser mayor a 0')

    if (typeof body.invoice_date !== 'string' || !ISO_DATE.test(body.invoice_date)) {
      return badRequest('Fecha de factura inválida')
    }
    if (typeof body.due_date !== 'string' || !ISO_DATE.test(body.due_date)) {
      return badRequest('Fecha de vencimiento inválida')
    }

    // Existencia del proveedor ANTES del insert: 404 preciso en vez de FK 23503.
    const { data: supplier } = await supabase
      .from('suppliers').select('id').eq('id', supplierId).single()
    if (!supplier) return notFound('El proveedor no existe')

    const payload: PayableInsert = {
      supplier_id: supplierId,
      concept,
      amount,
      invoice_date: body.invoice_date,
      due_date: body.due_date,
      status: 'pending',
      paid_at: null,
      notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
    }

    const { data, error } = await supabase
      .from('payables')
      .insert(payload)
      .select('*, supplier:suppliers(id, name, payment_terms_days)')
      .single()

    if (error || !data) {
      console.error('Error creating payable:', error)
      return serverError('Error al registrar la factura')
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Payables POST error:', error)
    return serverError('Error al registrar la factura')
  }
}
