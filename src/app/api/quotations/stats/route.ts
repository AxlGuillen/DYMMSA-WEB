import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, serverError } from '@/lib/api-helpers'
import type { QuotationStatus } from '@/types/database'

interface QuotationStats {
  draft: number
  sent_for_approval: number
  approved: number
  rejected: number
  converted_to_order: number
}

// GET /api/quotations/stats → conteo por status
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase.from('quotations').select('status')

    if (error) {
      console.error('Error counting quotations:', error)
      return serverError('Error al obtener las métricas')
    }

    const stats: QuotationStats = {
      draft: 0,
      sent_for_approval: 0,
      approved: 0,
      rejected: 0,
      converted_to_order: 0,
    }

    ;(data ?? []).forEach((q) => {
      const s = (q as { status: QuotationStatus }).status
      if (s in stats) stats[s]++
    })

    return NextResponse.json(stats)
  } catch (error) {
    console.error('Quotations stats error:', error)
    return serverError('Error al obtener las métricas')
  }
}
