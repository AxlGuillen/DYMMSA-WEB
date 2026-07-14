import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, serverError } from '@/lib/api-helpers'

interface BrandCount {
  brand: string
  count: number
}

// GET /api/urrea-catalog/stats → { total, brands: [{ brand, count }] }
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const [{ count, error }, { data: brandRows, error: brandError }] = await Promise.all([
      supabase.from('urrea_catalog').select('id', { count: 'exact', head: true }),
      supabase.rpc('urrea_catalog_brand_counts'),
    ])

    if (error) {
      console.error('Error counting urrea_catalog:', error)
      return serverError('Error al obtener el total')
    }
    // El desglose por marca es informativo (filtro): si falla, degrada a lista vacía.
    if (brandError) console.warn('urrea_catalog_brand_counts error (ignored):', brandError)

    const brands: BrandCount[] = (brandRows ?? []).map((r: BrandCount) => ({
      brand: r.brand,
      count: Number(r.count),
    }))

    return NextResponse.json({ total: count ?? 0, brands })
  } catch (error) {
    console.error('URREA catalog stats error:', error)
    return serverError('Error al obtener el total')
  }
}
