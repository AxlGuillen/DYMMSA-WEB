import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, serverError } from '@/lib/api-helpers'

// GET /api/time-entries/imports — periods already loaded, newest first
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase
      .from('time_imports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(52)

    if (error) {
      console.error('Error fetching time imports:', error)
      return serverError('Error al obtener las cargas')
    }
    return NextResponse.json(data ?? [])
  } catch (error) {
    console.error('Time imports GET error:', error)
    return serverError('Error al obtener las cargas')
  }
}
