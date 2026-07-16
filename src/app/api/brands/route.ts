import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import { normalizeBrandTag } from '@/lib/business-rules'
import type { Brand } from '@/types/database'

type BrandRow = Brand & { supplier_brands: { count: number }[] | null }

// GET /api/brands → todas las marcas con conteo de proveedores que las usan
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase
      .from('brands')
      .select('*, supplier_brands(count)')
      .order('name', { ascending: true })

    if (error) {
      console.error('Error listing brands:', error)
      return serverError('Error al obtener las marcas')
    }

    const brands = ((data ?? []) as BrandRow[]).map(({ supplier_brands, ...brand }) => ({
      ...brand,
      suppliersCount: supplier_brands?.[0]?.count ?? 0,
    }))

    return NextResponse.json({ brands })
  } catch (error) {
    console.error('Brands list error:', error)
    return serverError('Error al obtener las marcas')
  }
}

// POST /api/brands → crear marca (normalizada trim+upper)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as { name?: unknown }
    const name = typeof body.name === 'string' ? normalizeBrandTag(body.name) : ''
    if (!name) return badRequest('El nombre de la marca es obligatorio')

    const { data, error } = await supabase
      .from('brands')
      .insert({ name })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return badRequest('La marca ya existe')
      console.error('Error creating brand:', error)
      return serverError('Error al crear la marca')
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Brand create error:', error)
    return serverError('Error al crear la marca')
  }
}
