import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, apiError, notFound, serverError } from '@/lib/api-helpers'
import { correctTimeEntry } from '@/lib/time-entries-store'
import { isUuid } from '@/lib/text'
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
    // A malformed id would reach Postgres as a 22P02 → 500 (#157).
    if (!isUuid(id)) return notFound('La checada no existe')

    const { data, error } = await supabase.from('time_entries').delete().eq('id', id).select('id')
    if (error) {
      console.error('Error deleting time entry:', error)
      return serverError('Error al eliminar la checada')
    }
    if (!data || data.length === 0) return notFound('La checada no existe')
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Time entry DELETE error:', error)
    return serverError('Error al eliminar la checada')
  }
}
