import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { submitApproval } from '@/lib/approval-store'
import { QuotationError } from '@/lib/quotations-store'

// GET (public) — the quotation behind its approval token.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('quotations')
      .select('id, customer_name, status, total_amount, created_at, quotation_items(*)')
      .eq('approval_token', token)
      .limit(5000, { foreignTable: 'quotation_items' })
      .single()

    if (error || !data) {
      return NextResponse.json({ message: 'Cotización no encontrada' }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Approve GET error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}

// POST (public) — persists the client's decisions, all or nothing (#157): finalize=false saves progress
// (rest → null, link stays alive); finalize=true sends (rest → false, status → approved/rejected).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const body = await request.json().catch(() => null)
    return NextResponse.json(await submitApproval(createAdminClient(), token, body))
  } catch (error) {
    if (error instanceof QuotationError) return NextResponse.json(error.body, { status: error.status })
    console.error('Approve POST error:', error)
    return NextResponse.json({ message: 'Error interno' }, { status: 500 })
  }
}
