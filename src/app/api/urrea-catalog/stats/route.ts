import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, serverError } from '@/lib/api-helpers'

// GET /api/urrea-catalog/stats → { total }
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { count, error } = await supabase
      .from('urrea_catalog')
      .select('id', { count: 'exact', head: true })

    if (error) {
      console.error('Error counting urrea_catalog:', error)
      return serverError('Error al obtener el total')
    }

    return NextResponse.json({ total: count ?? 0 })
  } catch (error) {
    console.error('URREA catalog stats error:', error)
    return serverError('Error al obtener el total')
  }
}
