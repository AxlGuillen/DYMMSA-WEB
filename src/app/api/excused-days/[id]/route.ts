import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, notFound, serverError, isUuid } from '@/lib/api-helpers'

// DELETE /api/excused-days/[id] — admin
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return notFound('El día justificado no existe')
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase.from('excused_days').delete().eq('id', id).select('id')
    if (error) {
      console.error('Error deleting excused day:', error)
      return serverError('Error al quitar el día justificado')
    }
    if (!data || data.length === 0) return notFound('El día justificado no existe')
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Excused day DELETE error:', error)
    return serverError('Error al quitar el día justificado')
  }
}
