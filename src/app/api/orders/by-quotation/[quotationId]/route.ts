import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, serverError } from '@/lib/api-helpers'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ quotationId: string }> }
) {
  try {
    const { quotationId } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase
      .from('orders')
      .select('id, name, status')
      .eq('quotation_id', quotationId)
      .maybeSingle()

    if (error) {
      console.error('Get order by quotation error:', error)
      return serverError('Error al buscar la orden')
    }

    return NextResponse.json(data ?? null)
  } catch (error) {
    console.error('GET order by quotation error:', error)
    return serverError()
  }
}
