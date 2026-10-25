import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, apiError } from '@/lib/api-helpers'
import { correctTimeEntry, deleteTimeEntry } from '@/lib/time-entries-store'
import type { TimeEntryUpdate } from '@/types/database'

// PATCH /api/time-entries/[id] — admin correction with trace; source_clock_in is never touched
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as TimeEntryUpdate
    return NextResponse.json(await correctTimeEntry(supabase, id, body, auth.profile.id))
  } catch (error) {
    return apiError(error, 'Error al actualizar la checada', 'Time entry PATCH error:')
  }
}

// DELETE /api/time-entries/[id] (admin)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error
    await deleteTimeEntry(supabase, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, 'Error al eliminar la checada', 'Time entry DELETE error:')
  }
}
