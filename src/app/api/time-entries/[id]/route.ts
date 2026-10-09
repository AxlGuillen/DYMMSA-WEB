import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { correctTimeEntry, TimeEntryError } from '@/lib/time-entries-store'
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
    if (error instanceof TimeEntryError) return error.kind === 'not_found' ? notFound(error.message) : badRequest(error.message)
    console.error('Time entry PATCH error:', error)
    return serverError('Error al actualizar la checada')
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
