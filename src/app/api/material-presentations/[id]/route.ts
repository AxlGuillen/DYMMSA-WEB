import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, notFound, serverError } from '@/lib/api-helpers'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** DELETE: borra una captura errónea (#71). Seguro — nada referencia presentaciones, solo muere la sugerencia. */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase
      .from('material_presentations')
      .delete()
      .eq('id', id)
      .select('id')

    if (error) {
      console.error('material-presentations DELETE error:', error)
      return serverError('Error al eliminar la medida')
    }
    if (!data || data.length === 0) return notFound('Medida no encontrada')

    return NextResponse.json({ deleted: id })
  } catch (error) {
    console.error('material-presentations DELETE error:', error)
    return serverError()
  }
}
