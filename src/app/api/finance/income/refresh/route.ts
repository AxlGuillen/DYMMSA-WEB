import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import { todayInMexico } from '@/lib/format'
import { buildIncomeOverview, incomeUnavailable } from '@/lib/income'
import { OdooError } from '@/lib/odoo/client'
import { isOdooConfigured } from '@/lib/odoo/env'
import { INCOME_CACHE_TAG, loadIncomeFresh } from '@/lib/odoo/income-cache'
import { ISO_MONTH } from '../route'

export const maxDuration = 60

// POST /api/finance/income/refresh?month=YYYY-MM — purge the cache and answer with a fresh read.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const today = todayInMexico()
    const month = searchParams.get('month') ?? today.slice(0, 7)
    if (!ISO_MONTH.test(month)) return badRequest('Mes inválido — usa YYYY-MM')

    if (!isOdooConfigured()) return NextResponse.json(incomeUnavailable(month, today, 'not_configured'))

    // { expire: 0 } is the immediate purge; 'max' would be stale-while-revalidate and the
    // button would look broken. The next GET repopulates the Data Cache.
    revalidateTag(INCOME_CACHE_TAG, { expire: 0 })

    try {
      const { collections, open } = await loadIncomeFresh(month)
      return NextResponse.json(buildIncomeOverview(month, today, collections, open))
    } catch (error) {
      if (!(error instanceof OdooError)) throw error
      console.error('Odoo income refresh failed:', error.message)
      return NextResponse.json(incomeUnavailable(month, today, 'odoo_error'))
    }
  } catch (error) {
    console.error('Finance income refresh error:', error)
    return serverError('Error al actualizar los ingresos')
  }
}
