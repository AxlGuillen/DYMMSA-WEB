import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, serverError } from '@/lib/api-helpers'

interface BrandCountRow {
  brand: string | null
  total: number
  with_stock: number
}

// GET /api/inventory/stats → { total, in_stock, low_stock, sin_stock, with_stock, brands[] }
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const [{ data, error }, { data: brandData, error: brandError }] = await Promise.all([
      supabase.from('store_inventory').select('quantity'),
      supabase.rpc('inventory_brand_counts'),
    ])

    if (error) {
      console.error('Error counting store_inventory:', error)
      return serverError('Error al obtener las métricas')
    }
    // El selector de marca es un extra: si la RPC falla, la página sigue viva
    // con sus tarjetas de stock (mismo criterio que el catálogo URREA).
    if (brandError) console.warn('inventory_brand_counts error (ignored):', brandError)

    const items = (data ?? []) as { quantity: number }[]
    const brands = ((brandData ?? []) as BrandCountRow[]).map((row) => ({
      brand: row.brand,
      total: Number(row.total),
      with_stock: Number(row.with_stock),
    }))

    return NextResponse.json({
      total: items.length,
      sin_stock: items.filter((i) => i.quantity === 0).length,
      with_stock: items.filter((i) => i.quantity > 0).length,
      low_stock: items.filter((i) => i.quantity > 0 && i.quantity <= 5).length,
      in_stock: items.filter((i) => i.quantity > 5).length,
      brands,
    })
  } catch (error) {
    console.error('Inventory stats error:', error)
    return serverError('Error al obtener las métricas')
  }
}
