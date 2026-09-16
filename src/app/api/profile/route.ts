import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, notFound, serverError } from '@/lib/api-helpers'

// GET /api/profile — the caller's own profile (role decides what the UI shows; the server still enforces)
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, role, clock_employee_id')
      .eq('id', auth.user.id)
      .single()

    if (error || !data) {
      if (error?.code === 'PGRST116') return notFound('Tu perfil no existe')
      console.error('Error fetching profile:', error)
      return serverError('Error al obtener el perfil')
    }
    return NextResponse.json(data)
  } catch (error) {
    console.error('Profile GET error:', error)
    return serverError('Error al obtener el perfil')
  }
}
