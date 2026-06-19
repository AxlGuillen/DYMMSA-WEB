import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import type { StoreInventoryInsert } from '@/types/database'

const STOCK_FILTERS = ['all', 'in_stock', 'low_stock', 'sin_stock'] as const
type StockFilter = (typeof STOCK_FILTERS)[number]

/** Escapa el patrón de búsqueda para `ilike` (model_code no usa `.or()`). */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[%]/g, ' ').trim()
}

// GET /api/inventory?page=&pageSize=&search=&stockFilter=&quantitySort=
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10) || 20))
    const search = sanitizeSearch(searchParams.get('search') ?? '')

    const stockFilterParam = searchParams.get('stockFilter') ?? 'all'
    const stockFilter: StockFilter = STOCK_FILTERS.includes(stockFilterParam as StockFilter)
      ? (stockFilterParam as StockFilter)
      : 'all'

    const quantitySortParam = searchParams.get('quantitySort')
    const quantitySort = quantitySortParam === 'asc' || quantitySortParam === 'desc' ? quantitySortParam : null

    let query = supabase.from('store_inventory').select('*', { count: 'exact' })

    if (search) query = query.ilike('model_code', `%${search}%`)

    if (stockFilter === 'sin_stock') query = query.eq('quantity', 0)
    else if (stockFilter === 'low_stock') query = query.gt('quantity', 0).lte('quantity', 5)
    else if (stockFilter === 'in_stock') query = query.gt('quantity', 5)

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const orderCol = quantitySort ? 'quantity' : 'model_code'
    const ascending = quantitySort ? quantitySort === 'asc' : true

    const { data, error, count } = await query
      .order(orderCol, { ascending })
      .range(from, to)

    if (error) {
      console.error('Error listing store_inventory:', error)
      return serverError('Error al obtener el inventario')
    }

    return NextResponse.json({
      data: data ?? [],
      count: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    })
  } catch (error) {
    console.error('Inventory list error:', error)
    return serverError('Error al obtener el inventario')
  }
}

// POST /api/inventory → crear producto de inventario
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as Partial<StoreInventoryInsert>
    const modelCode = typeof body.model_code === 'string' ? body.model_code.trim() : ''
    if (!modelCode) return badRequest('El código modelo es obligatorio')

    const quantity = typeof body.quantity === 'number' ? Math.max(0, Math.trunc(body.quantity)) : 0

    const { data, error } = await supabase
      .from('store_inventory')
      .insert({ model_code: modelCode, quantity })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return badRequest('Ya existe un producto con ese código modelo')
      console.error('Error creating store_inventory item:', error)
      return serverError('Error al crear el producto')
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Inventory create error:', error)
    return serverError('Error al crear el producto')
  }
}
