import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { normalizeEntryTimes, normalizeTime } from '@/lib/timesheet'
import type { TimeEntry, TimeEntryUpdate } from '@/types/database'

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
    const { data: current } = await supabase
      .from('time_entries').select('*').eq('id', id).single()
    if (!current) return notFound('La checada no existe')
    const row = normalizeEntryTimes(current as TimeEntry)

    const updates: Record<string, unknown> = {}
    let clockIn = row.clock_in
    let clockOut = row.clock_out

    if (body.clock_in !== undefined) {
      const t = typeof body.clock_in === 'string' ? normalizeTime(body.clock_in) : null
      if (!t) return badRequest('Hora de entrada inválida')
      clockIn = t
      updates.clock_in = t
    }
    if (body.clock_out !== undefined) {
      if (body.clock_out === null || body.clock_out === '') {
        clockOut = null
      } else {
        const t = typeof body.clock_out === 'string' ? normalizeTime(body.clock_out) : null
        if (!t) return badRequest('Hora de salida inválida')
        clockOut = t
      }
      updates.clock_out = clockOut
    }
    if (body.note !== undefined) {
      updates.note = typeof body.note === 'string' ? body.note.trim() || null : null
    }
    if (Object.keys(updates).length === 0) return badRequest('No hay cambios para guardar')
    if (clockOut !== null && clockOut < clockIn) return badRequest('La salida no puede ser antes de la entrada')

    // Only a time change seals the trace: the import skips rows with edited_at,
    // so a note alone must not freeze a pair the clock may still complete (ADR-026).
    if (clockIn !== row.clock_in || clockOut !== row.clock_out) {
      updates.edited_by = auth.profile.id
      updates.edited_at = new Date().toISOString()
      // Written once: what the clock said survives every later correction.
      if (row.original == null) {
        updates.original = { clock_in: row.clock_in, clock_out: row.clock_out, note: row.note }
      }
    }

    const { data, error } = await supabase
      .from('time_entries')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single()

    if (error || !data) {
      if (error?.code === 'PGRST116') return notFound('La checada no existe')
      console.error('Error updating time entry:', error)
      return serverError('Error al actualizar la checada')
    }
    return NextResponse.json(normalizeEntryTimes(data as TimeEntry))
  } catch (error) {
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
