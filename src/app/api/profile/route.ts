import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError, notFound, serverError } from '@/lib/api-helpers'
import { presentProfile } from '@/lib/profile'
import { OWN_PROFILE_COLUMNS as OWN_COLUMNS, updateOwnProfile } from '@/lib/profiles-store'
import type { OwnProfile, Profile } from '@/types/database'

type OwnRow = Omit<Profile, 'created_at' | 'updated_at'>

// GET /api/profile — the caller's own profile (role decides what the UI shows; the server still enforces)
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase.from('profiles').select(OWN_COLUMNS).eq('id', auth.user.id).single()

    if (error || !data) {
      if (error?.code === 'PGRST116') return notFound('Tu perfil no existe')
      console.error('Error fetching profile:', error)
      return serverError('Error al obtener el perfil')
    }
    const profile: OwnProfile = { ...presentProfile(data as OwnRow), email: auth.user.email ?? null }
    return NextResponse.json(profile)
  } catch (error) {
    console.error('Profile GET error:', error)
    return serverError('Error al obtener el perfil')
  }
}

// PATCH /api/profile — display name and NSS of the caller (#122); role, shift and clock id stay with the admin
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const data = await updateOwnProfile(supabase, auth.user.id, await request.json())
    const profile: OwnProfile = { ...presentProfile(data), email: auth.user.email ?? null }
    return NextResponse.json(profile)
  } catch (error) {
    return apiError(error, 'Error al actualizar tu perfil', 'Profile PATCH error:')
  }
}
