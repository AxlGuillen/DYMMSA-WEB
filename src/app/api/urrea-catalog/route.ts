import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeCatalogCode, normalizeCatalogBrand } from '@/lib/business-rules'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import type { UrreaCatalogInsert } from '@/types/database'

const SORT_FIELDS = ['code', 'brand', 'description', 'std'] as const
type SortField = (typeof SORT_FIELDS)[number]

/** Quita los caracteres que rompen la sintaxis del filtro `.or()` de PostgREST. */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%]/g, ' ').trim()
}

// GET /api/urrea-catalog?page=&pageSize=&search=&sortField=&sortDir=
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10) || 20))
    const search = sanitizeSearch(searchParams.get('search') ?? '')

    const sortFieldParam = searchParams.get('sortField') ?? 'description'
    const sortField: SortField = SORT_FIELDS.includes(sortFieldParam as SortField)
      ? (sortFieldParam as SortField)
      : 'description'
    const ascending = searchParams.get('sortDir') !== 'desc'
    const brand = searchParams.get('brand')?.trim()

    let query = supabase.from('urrea_catalog').select('*', { count: 'exact' })

    if (search) {
      query = query.or(`code.ilike.%${search}%,description.ilike.%${search}%`)
    }
    if (brand) {
      query = query.eq('brand', normalizeCatalogBrand(brand))
    }

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const { data, error, count } = await query
      .order(sortField, { ascending, nullsFirst: false })
      .range(from, to)

    if (error) {
      console.error('Error listing urrea_catalog:', error)
      return serverError('Error al obtener el catálogo')
    }

    return NextResponse.json({
      data: data ?? [],
      count: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    })
  } catch (error) {
    console.error('URREA catalog list error:', error)
    return serverError('Error al obtener el catálogo')
  }
}

// POST /api/urrea-catalog  → crear producto
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as Partial<UrreaCatalogInsert>
    // Normalizada: llave de cruce con model_code (resolución Descripción DYMMSA)
    const code = typeof body.code === 'string' ? normalizeCatalogCode(body.code) : ''
    if (!code) return badRequest('El código es obligatorio')

    const std = typeof body.std === 'number' && body.std > 0 ? body.std : 1
    const payload: UrreaCatalogInsert = {
      code,
      brand: normalizeCatalogBrand(body.brand),
      description: body.description?.trim() || null,
      std,
    }

    const { data, error } = await supabase
      .from('urrea_catalog')
      .insert(payload)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return badRequest('Ya existe un producto con ese código y marca')
      console.error('Error creating urrea_catalog item:', error)
      return serverError('Error al crear el producto')
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('URREA catalog create error:', error)
    return serverError('Error al crear el producto')
  }
}
