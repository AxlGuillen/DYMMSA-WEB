import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import { formatISODate } from '@/lib/format'
import { summarizeMonth } from '@/lib/payables'
import type { Payable } from '@/types/database'

const ISO_MONTH = /^\d{4}-\d{2}$/

/**
 * GET /api/payables/overview?month=YYYY-MM → resumen del mes + filas crudas
 * para la lista por semana. Trae TODAS las pendientes (las vencidas de meses
 * previos cuentan en el overview) + las pagadas del mes; la matemática vive
 * en src/lib/payables.ts.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month') ?? formatISODate().slice(0, 7)
    if (!ISO_MONTH.test(month)) return badRequest('Mes inválido — usa YYYY-MM')

    const [pendingRes, paidRes] = await Promise.all([
      supabase
        .from('payables')
        .select('*, supplier:suppliers(id, name, payment_terms_days)')
        .eq('status', 'pending')
        .order('due_date', { ascending: true })
        .limit(1000),
      supabase
        .from('payables')
        .select('*, supplier:suppliers(id, name, payment_terms_days)')
        .eq('status', 'paid')
        .gte('paid_at', `${month}-01`)
        .lte('paid_at', `${month}-31`)
        .limit(1000),
    ])

    if (pendingRes.error || paidRes.error) {
      console.error('Error fetching payables overview:', pendingRes.error ?? paidRes.error)
      return serverError('Error al obtener el resumen de finanzas')
    }

    const rows = [...(pendingRes.data ?? []), ...(paidRes.data ?? [])] as Payable[]
    const summary = summarizeMonth(rows, month, formatISODate())

    return NextResponse.json({ month, summary, payables: rows })
  } catch (error) {
    console.error('Payables overview error:', error)
    return serverError('Error al obtener el resumen de finanzas')
  }
}
