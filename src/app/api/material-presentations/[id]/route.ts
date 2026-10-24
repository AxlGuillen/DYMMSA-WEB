import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { deleteMaterialPresentation } from '@/lib/materials-store'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** DELETE — drop a mistyped capture (#71). Safe: nothing references presentations. */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    await deleteMaterialPresentation(supabase, id)
    return NextResponse.json({ deleted: id })
  } catch (error) {
    return apiError(error, 'Error interno', 'material-presentations DELETE error:')
  }
}
