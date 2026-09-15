import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import { todayInMexico } from '@/lib/format'
import { summarizeMonth } from '@/lib/payables'
import { ISO_MONTH, monthRange } from '@/lib/month'
import type { Payable } from '@/types/database'

// Both feed the month closing (#94) — pending the projection, paid the real figure:
// a silent cut would lie, so each read reports whether it filled its limit.
const PENDING_LIMIT = 1000
const PAID_LIMIT = 1000

// GET /api/payables/overview?month=YYYY-MM — month summary + raw rows for the weekly list.
// Pulls ALL pending (overdue from earlier months count here) + the month's paid; math in lib/payables.ts.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month') ?? todayInMexico().slice(0, 7)
    if (!ISO_MONTH.test(month)) return badRequest('Mes inválido — usa YYYY-MM')

    const { from, toExclusive } = monthRange(month)
    const [pendingRes, paidRes] = await Promise.all([
      supabase
        .from('payables')
        .select('*, supplier:suppliers(id, name, payment_terms_days)', { count: 'exact' })
        .eq('status', 'pending')
        // id breaks the tie: due_date is not unique, so a truncated read would still vary.
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .limit(PENDING_LIMIT),
      supabase
        .from('payables')
        .select('*, supplier:suppliers(id, name, payment_terms_days)', { count: 'exact' })
        .eq('status', 'paid')
        .gte('paid_at', from)
        .lt('paid_at', toExclusive)
        .order('paid_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(PAID_LIMIT),
    ])

    if (pendingRes.error || paidRes.error) {
      console.error('Error fetching payables overview:', pendingRes.error ?? paidRes.error)
      return serverError('Error al obtener el resumen de finanzas')
    }

    const rows = [...(pendingRes.data ?? []), ...(paidRes.data ?? [])] as Payable[]
    const summary = summarizeMonth(rows, month, todayInMexico())

    const pendingTruncated = (pendingRes.count ?? 0) > PENDING_LIMIT
    const paidTruncated = (paidRes.count ?? 0) > PAID_LIMIT

    return NextResponse.json({ month, summary, payables: rows, pendingTruncated, paidTruncated })
  } catch (error) {
    console.error('Payables overview error:', error)
    return serverError('Error al obtener el resumen de finanzas')
  }
}
