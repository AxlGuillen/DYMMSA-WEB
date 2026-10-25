import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError, serverError } from '@/lib/api-helpers'
import { createInventoryItem } from '@/lib/inventory-store'
import { STOCK_FILTERS, type StockFilter } from '@/lib/stock-filters'

/** "No brand" is a filterable category (#53): stocked items whose ETM carries no brand. */
export const NO_BRAND = '__none__'

/** Escapes the search pattern for `ilike` (model_code does not go through `.or()`). */
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

    const brand = (searchParams.get('brand') ?? '').trim()

    // Read from the view, not the table, so the brand filter runs BEFORE paging:
    // the brand lives in etm_products, not here.
    let query = supabase.from('store_inventory_with_brand').select('*', { count: 'exact' })

    if (search) query = query.ilike('model_code', `%${search}%`)

    if (brand === NO_BRAND) query = query.is('brand', null)
    else if (brand) query = query.eq('brand', brand.toUpperCase())

    if (stockFilter === 'sin_stock') query = query.eq('quantity', 0)
    else if (stockFilter === 'with_stock') query = query.gt('quantity', 0)
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

// POST /api/inventory — create an inventory item
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    return NextResponse.json(await createInventoryItem(supabase, await request.json()), { status: 201 })
  } catch (error) {
    return apiError(error, 'Error al crear el producto', 'Inventory create error:')
  }
}

