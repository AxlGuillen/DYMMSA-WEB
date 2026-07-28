import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import type { EtmProductInsert } from '@/types/database'

const SORT_COLUMNS = ['etm', 'description_es', 'model_code', 'price'] as const
type SortColumn = (typeof SORT_COLUMNS)[number]

/**
 * Escapa el patrón de búsqueda:
 *  - `,` `(` `)` son separadores del filtro de `.or()`, donde el término se
 *    interpola: sin quitarlos, una búsqueda podría alterar el filtro.
 *  - `%` y `*` son comodines de `ilike` en PostgREST — buscarlos literalmente
 *    devolvería resultados de más en vez de coincidencias exactas.
 */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[%*,()]/g, ' ').trim()
}

/** Columnas TEXT NOT NULL: se normalizan a cadena recortada (nunca null). */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

// POST /api/products → crear producto del catálogo ETM
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as Partial<EtmProductInsert>
    const etm = typeof body.etm === 'string' ? body.etm.trim() : ''
    if (!etm) return badRequest('El ETM es obligatorio')

    const { data, error } = await supabase
      .from('etm_products')
      .insert({
        etm,
        description: text(body.description),
        description_es: text(body.description_es),
        // Única columna de texto nullable (jerarquía de catálogo, ADR-013).
        dymmsa_description: text(body.dymmsa_description) || null,
        model_code: text(body.model_code),
        brand: text(body.brand),
        price: typeof body.price === 'number' && Number.isFinite(body.price) ? body.price : 0,
        is_sold: typeof body.is_sold === 'boolean' ? body.is_sold : null,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return badRequest(`Ya existe un producto con el ETM ${etm}`)
      console.error('Error creating etm_product:', error)
      return serverError('Error al crear el producto')
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Product create error:', error)
    return serverError('Error al crear el producto')
  }
}
