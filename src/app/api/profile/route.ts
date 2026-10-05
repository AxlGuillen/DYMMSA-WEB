import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { parseDisplayName, parseNss, presentProfile } from '@/lib/profile'
import type { OwnProfile, OwnProfileUpdate, Profile } from '@/types/database'

// No hourly_rate: pay amounts are never shown to the person (2026-10-05).
const OWN_COLUMNS = 'id, display_name, role, clock_employee_id, shift, nss, avatar_path, is_owner, area'
const EDITABLE = new Set<keyof OwnProfileUpdate>(['display_name', 'nss'])

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

    const body = ((await request.json()) ?? {}) as Record<string, unknown>
    if (Object.keys(body).some((key) => !EDITABLE.has(key as keyof OwnProfileUpdate))) {
      return badRequest('Solo puedes editar tu nombre y tu NSS; lo demás lo cambia un administrador')
    }

    const updates: OwnProfileUpdate = {}
    if (body.display_name !== undefined) {
      const name = parseDisplayName(body.display_name)
      if ('error' in name) return badRequest(name.error)
      updates.display_name = name.value
    }
    if (body.nss !== undefined) {
      const nss = parseNss(body.nss)
      if ('error' in nss) return badRequest(nss.error)
      updates.nss = nss.value
    }
    if (Object.keys(updates).length === 0) return badRequest('No hay cambios para guardar')

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', auth.user.id)
      .select(OWN_COLUMNS)
      .single()

    if (error || !data) {
      if (error?.code === 'PGRST116') return notFound('Tu perfil no existe')
      console.error('Error updating own profile:', error)
      return serverError('Error al actualizar tu perfil')
    }
    const profile: OwnProfile = { ...presentProfile(data as OwnRow), email: auth.user.email ?? null }
    return NextResponse.json(profile)
  } catch (error) {
    console.error('Profile PATCH error:', error)
    return serverError('Error al actualizar tu perfil')
  }
}
