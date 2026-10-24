import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, serverError } from '@/lib/api-helpers'
import { DomainError } from '@/lib/domain-error'
import { createProduct, parseProductInput } from '@/lib/products-store'

const SORT_COLUMNS = ['etm', 'description_es', 'model_code', 'price'] as const
type SortColumn = (typeof SORT_COLUMNS)[number]

/** Strips `,()` (they would alter the .or() filter) and `%*` (ilike wildcards). */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[%*,()]/g, ' ').trim()
}

// GET /api/products?page=&pageSize=&search=&sortBy=&sortDir=
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10) || 20))
    const search = sanitizeSearch(searchParams.get('search') ?? '')

    const sortByParam = searchParams.get('sortBy') ?? 'etm'
    const sortBy: SortColumn = SORT_COLUMNS.includes(sortByParam as SortColumn)
      ? (sortByParam as SortColumn)
      : 'etm'
    const sortDir = searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc'

    let query = supabase.from('etm_products').select('*', { count: 'exact' })

    if (search) {
      query = query.or(
        `etm.ilike.%${search}%,model_code.ilike.%${search}%,description_es.ilike.%${search}%,description.ilike.%${search}%`,
      )
    }

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const { data, error, count } = await query
      .order(sortBy, { ascending: sortDir === 'asc' })
      .range(from, to)

    if (error) {
      console.error('Error listing etm_products:', error)
      return serverError('Error al obtener los productos')
    }

    return NextResponse.json({
      data: data ?? [],
      count: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    })
  } catch (error) {
    console.error('Products list error:', error)
    return serverError('Error al obtener los productos')
  }
}

// POST /api/products — create an ETM catalog product
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = await request.json().catch(() => null)
    const product = await createProduct(supabase, parseProductInput(body, { create: true }))
    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json(error.body, { status: error.status })
    console.error('Product create error:', error)
    return serverError('Error al crear el producto')
  }
}
