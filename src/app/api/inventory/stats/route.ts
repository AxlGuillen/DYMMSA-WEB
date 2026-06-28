import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, serverError } from '@/lib/api-helpers'

// GET /api/inventory/stats → { total, in_stock, low_stock, sin_stock }
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase.from('store_inventory').select('quantity')

    if (error) {
      console.error('Error counting store_inventory:', error)
      return serverError('Error al obtener las métricas')
    }

    const items = (data ?? []) as { quantity: number }[]
    return NextResponse.json({
      total: items.length,
      sin_stock: items.filter((i) => i.quantity === 0).length,
      low_stock: items.filter((i) => i.quantity > 0 && i.quantity <= 5).length,
      in_stock: items.filter((i) => i.quantity > 5).length,
    })
  } catch (error) {
    console.error('Inventory stats error:', error)
    return serverError('Error al obtener las métricas')
  }
}
