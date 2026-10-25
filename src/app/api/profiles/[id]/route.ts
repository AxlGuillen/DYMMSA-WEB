import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, apiError, notFound, isUuid } from '@/lib/api-helpers'
import { PROFILE_WITH_PAY_COLUMNS, presentProfile, type PayEmbed } from '@/lib/profile'
import { updateProfileAsAdmin } from '@/lib/profiles-store'
import type { Profile, ProfileUpdate } from '@/types/database'

// PATCH /api/profiles/[id] — display name, role, clock id, shift, area, NSS, hourly rate (admin)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error
    if (!isUuid(id)) return notFound('El perfil no existe')

    const body = (await request.json()) as ProfileUpdate
    const data = await updateProfileAsAdmin(supabase, id, body, PROFILE_WITH_PAY_COLUMNS)
    return NextResponse.json(presentProfile(data as Profile & { profile_pay: PayEmbed }))
  } catch (error) {
    return apiError(error, 'Error al actualizar el perfil', 'Profile PATCH error:')
  }
}
