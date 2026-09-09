import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import { todayInMexico } from '@/lib/format'
import { buildIncomeOverview, incomeUnavailable } from '@/lib/income'
import { OdooError } from '@/lib/odoo/client'
import { isOdooConfigured } from '@/lib/odoo/env'
import { cachedMonthCollections, cachedOpenReceivables } from '@/lib/odoo/income-cache'

// Two cold Odoo reads can exceed Vercel's default function timeout (same as /api/mcp).
export const maxDuration = 60

export const ISO_MONTH = /^\d{4}-\d{2}$/

// GET /api/finance/income?month=YYYY-MM — the month's collections + open receivables, read from
// Odoo through the Data Cache. Odoo down or absent → 200 with income: null, never a broken screen.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const today = todayInMexico()
    const month = searchParams.get('month') ?? today.slice(0, 7)
    if (!ISO_MONTH.test(month)) return badRequest('Mes inválido — usa YYYY-MM')

    if (!isOdooConfigured()) return NextResponse.json(incomeUnavailable(month, today, 'not_configured'))

    try {
      // The Odoo queue serializes these; Promise.all only overlaps the cache lookups.
      const [collections, open] = await Promise.all([cachedMonthCollections(month), cachedOpenReceivables()])
      return NextResponse.json(buildIncomeOverview(month, today, collections, open))
    } catch (error) {
      if (!(error instanceof OdooError)) throw error
      console.error('Odoo income read failed:', error.message)
      return NextResponse.json(incomeUnavailable(month, today, 'odoo_error'))
    }
  } catch (error) {
    console.error('Finance income GET error:', error)
    return serverError('Error al obtener los ingresos')
  }
}
