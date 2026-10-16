import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { todayInMexico } from '@/lib/format'
import {
  customerCreditNotes,
  customerStatement,
  parseStatementRange,
  type CustomerDetailResponse,
  type CustomersUnavailableReason,
  type StatementRange,
} from '@/lib/customers'
import { OdooError } from '@/lib/odoo/client'
import { isOdooConfigured } from '@/lib/odoo/env'
import { cachedCustomerActivity, cachedOpenCustomerMoves } from '@/lib/odoo/income-cache'

export const maxDuration = 60

const unavailable = (today: string, range: StatementRange, reason: CustomersUnavailableReason): CustomerDetailResponse => ({
  today, range, customer: null, statement: null, creditNotes: null, sales: null, payments: null, reason, truncated: false, fetchedAt: null,
})

// GET /api/clients/[id]?from=&to=&filter= — one Odoo customer: contact, statement in the due-date window,
// unapplied credit notes, latest sales and payments (#145). [id] is the Odoo partner id.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { id: rawId } = await params
    const id = Number(rawId)
    if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id <= 0) return notFound('Cliente no encontrado')

    const today = todayInMexico()
    const parsed = parseStatementRange(new URL(request.url).searchParams, today)
    if (!parsed.ok) return badRequest(parsed.error)
    const { range } = parsed

    if (!isOdooConfigured()) return NextResponse.json(unavailable(today, range, 'not_configured'))

    try {
      const [detail, moves] = await Promise.all([cachedCustomerActivity(id), cachedOpenCustomerMoves()])
      // A partner Odoo no longer returns but still invoiced keeps its statement (same rule as the list).
      const invoiced = moves.rows.find((m) => m.customerId === id)
      const customer = detail.customer ?? (invoiced
        ? { id, name: invoiced.customer ?? 'Sin nombre', city: null, phone: null, email: null, vat: null, daysToPay: null }
        : null)
      if (!customer) return notFound('Cliente no encontrado')

      const body: CustomerDetailResponse = {
        today,
        range,
        customer,
        statement: customerStatement(moves.rows, id, range, today),
        creditNotes: customerCreditNotes(moves.rows, id),
        sales: detail.sales,
        payments: detail.payments,
        reason: null,
        truncated: moves.truncated,
        fetchedAt: [moves.fetchedAt, detail.fetchedAt].sort()[0],
      }
      return NextResponse.json(body)
    } catch (error) {
      if (!(error instanceof OdooError)) throw error
      console.error('Odoo customer read failed:', error.message)
      return NextResponse.json(unavailable(today, range, 'odoo_error'))
    }
  } catch (error) {
    console.error('Client GET error:', error)
    return serverError('Error al obtener el cliente')
  }
}
