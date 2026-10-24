import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, apiError } from '@/lib/api-helpers'
import { deleteExcusedDay } from '@/lib/excused-days-store'

// DELETE /api/excused-days/[id] — admin
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    await deleteExcusedDay(supabase, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, 'Error al quitar el día justificado', 'Excused day DELETE error:')
  }
}
