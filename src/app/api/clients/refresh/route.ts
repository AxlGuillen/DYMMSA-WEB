import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, serverError } from '@/lib/api-helpers'
import { CUSTOMERS_CACHE_TAG, INCOME_CACHE_TAG } from '@/lib/odoo/income-cache'

// POST /api/clients/refresh — purge the customer reads AND the open receivables they share with
// Finanzas; the screens refetch right after (#145). { expire: 0 }: 'max' would serve stale (ADR-027 §7).
export async function POST() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    revalidateTag(CUSTOMERS_CACHE_TAG, { expire: 0 })
    revalidateTag(INCOME_CACHE_TAG, { expire: 0 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Clients refresh error:', error)
    return serverError('Error al actualizar los clientes')
  }
}
