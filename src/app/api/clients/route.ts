import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import { todayInMexico } from '@/lib/format'
import {
  customersTotals,
  parseStatementRange,
  summarizeCustomers,
  type CustomersResponse,
  type CustomersUnavailableReason,
  type StatementRange,
} from '@/lib/customers'
import { OdooError } from '@/lib/odoo/client'
import { isOdooConfigured } from '@/lib/odoo/env'
import { cachedCustomers, cachedOpenCustomerMoves } from '@/lib/odoo/income-cache'

// Two cold Odoo reads can exceed Vercel's default function timeout (same as /api/finance/income).
export const maxDuration = 60

const unavailable = (today: string, range: StatementRange, reason: CustomersUnavailableReason): CustomersResponse => ({
  today, range, customers: null, totals: null, reason, truncated: false, fetchedAt: null,
})

// GET /api/clients?from=&to=&filter= — every Odoo customer with its balance in the due-date window
// (#145). Odoo down or absent → 200 with customers: null, never a broken screen.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const today = todayInMexico()
    const parsed = parseStatementRange(new URL(request.url).searchParams, today)
    if (!parsed.ok) return badRequest(parsed.error)
    const { range } = parsed

    if (!isOdooConfigured()) return NextResponse.json(unavailable(today, range, 'not_configured'))

    try {
      // The Odoo queue serializes these; Promise.all only overlaps the cache lookups.
      const [customers, moves] = await Promise.all([cachedCustomers(), cachedOpenCustomerMoves()])
      const rows = summarizeCustomers(customers.rows, moves.rows, range, today)
      const body: CustomersResponse = {
        today,
        range,
        customers: rows,
        totals: customersTotals(rows),
        reason: null,
        truncated: customers.truncated || moves.truncated,
        // The older read is what "Actualizado hace X" must admit to.
        fetchedAt: customers.fetchedAt < moves.fetchedAt ? customers.fetchedAt : moves.fetchedAt,
      }
      return NextResponse.json(body)
    } catch (error) {
      if (!(error instanceof OdooError)) throw error
      console.error('Odoo customers read failed:', error.message)
      return NextResponse.json(unavailable(today, range, 'odoo_error'))
    }
  } catch (error) {
    console.error('Clients GET error:', error)
    return serverError('Error al obtener los clientes')
  }
}
