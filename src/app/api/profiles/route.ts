import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, serverError } from '@/lib/api-helpers'
import { PROFILE_WITH_PAY_COLUMNS, presentProfile, type PayEmbed } from '@/lib/profile'
import type { Profile } from '@/types/database'

// GET /api/profiles — every team profile (admin)
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_WITH_PAY_COLUMNS)
      .order('display_name', { ascending: true })

    if (error) {
      console.error('Error fetching profiles:', error)
      return serverError('Error al obtener los perfiles')
    }
    return NextResponse.json(((data ?? []) as (Profile & { profile_pay: PayEmbed })[]).map(presentProfile))
  } catch (error) {
    console.error('Profiles GET error:', error)
    return serverError('Error al obtener los perfiles')
  }
}
