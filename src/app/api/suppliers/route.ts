import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import type { Brand, SupplierInsert, SupplierWithBrands } from '@/types/database'

const SORT_FIELDS = ['name', 'updated_at'] as const
type SortField = (typeof SORT_FIELDS)[number]

/** Quita los caracteres que rompen la sintaxis del filtro `.or()` de PostgREST. */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%]/g, ' ').trim()
}

/** Fila cruda del embed supplier_brands(brands(...)) → brands aplanadas y ordenadas. */
type SupplierRow = Omit<SupplierWithBrands, 'brands'> & {
  supplier_brands: { brands: Brand | null }[] | null
}

function flattenBrands(row: SupplierRow): SupplierWithBrands {
  const { supplier_brands, ...supplier } = row
  const brands = (supplier_brands ?? [])
    .map((link) => link.brands)
    .filter((brand): brand is Brand => brand != null)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return { ...supplier, brands }
}

// GET /api/suppliers?page=&pageSize=&search=&sortField=&sortDir=&brandId=
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10) || 20))
    const search = sanitizeSearch(searchParams.get('search') ?? '')

    const sortFieldParam = searchParams.get('sortField') ?? 'name'
    const sortField: SortField = SORT_FIELDS.includes(sortFieldParam as SortField)
      ? (sortFieldParam as SortField)
      : 'name'
    const ascending = searchParams.get('sortDir') !== 'desc'
    const brandId = searchParams.get('brandId')?.trim()

    let query = supabase
      .from('suppliers')
      .select('*, supplier_brands(brands(id, name, created_at))', { count: 'exact' })

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,phone.ilike.%${search}%,whatsapp.ilike.%${search}%,email.ilike.%${search}%`,
      )
    }

    // Filtro por marca: ids de proveedores que la tienen asignada.
    if (brandId) {
      const { data: links, error: linksError } = await supabase
        .from('supplier_brands')
        .select('supplier_id')
        .eq('brand_id', brandId)
      if (linksError) {
        console.error('Error filtering suppliers by brand:', linksError)
        return serverError('Error al filtrar por marca')
      }
      const supplierIds = (links ?? []).map((l) => l.supplier_id)
      if (supplierIds.length === 0) {
        return NextResponse.json({ data: [], count: 0, page, pageSize, totalPages: 0 })
      }
      query = query.in('id', supplierIds)
    }

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const { data, error, count } = await query
      .order(sortField, { ascending, nullsFirst: false })
      .range(from, to)

    if (error) {
      console.error('Error listing suppliers:', error)
      return serverError('Error al obtener los proveedores')
    }

    return NextResponse.json({
      data: ((data ?? []) as SupplierRow[]).map(flattenBrands),
      count: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    })
  } catch (error) {
    console.error('Suppliers list error:', error)
    return serverError('Error al obtener los proveedores')
  }
}

interface CreateSupplierBody extends Partial<SupplierInsert> {
  brandIds?: string[]
}

// POST /api/suppliers → crear proveedor (+ links de marcas)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as CreateSupplierBody
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return badRequest('El nombre del proveedor es obligatorio')
    if (body.brandIds !== undefined && !Array.isArray(body.brandIds)) {
      return badRequest('brandIds debe ser un arreglo')
    }

    const payload: SupplierInsert = {
      name,
      phone: body.phone?.trim() || null,
      whatsapp: body.whatsapp?.trim() || null,
      email: body.email?.trim() || null,
      address: body.address?.trim() || null,
      notes: body.notes?.trim() || null,
    }

    const { data: supplier, error } = await supabase
      .from('suppliers')
      .insert(payload)
      .select()
      .single()

    if (error || !supplier) {
      if (error?.code === '23505') return badRequest('Ya existe un proveedor con ese nombre')
      console.error('Error creating supplier:', error)
      return serverError('Error al crear el proveedor')
    }

    const brandIds = [...new Set(body.brandIds ?? [])]
    if (brandIds.length > 0) {
      const { error: linksError } = await supabase
        .from('supplier_brands')
        .insert(brandIds.map((brand_id) => ({ supplier_id: supplier.id, brand_id })))

      if (linksError) {
        // Rollback: sin sus marcas el registro queda a medias — se elimina el padre.
        await supabase.from('suppliers').delete().eq('id', supplier.id)
        console.error('Error linking supplier brands (rolled back):', linksError)
        return serverError('Error al asignar las marcas del proveedor')
      }
    }

    return NextResponse.json(supplier, { status: 201 })
  } catch (error) {
    console.error('Supplier create error:', error)
    return serverError('Error al crear el proveedor')
  }
}
