import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { fetchCatalogDescriptionMap } from '@/lib/urrea-catalog'

// ------------------------------------------------------------------ //
// POST /api/urrea-catalog/lookup                                      //
// Batch: { codes: string[] } → { descriptions: Record<code, desc> }   //
// Códigos normalizados (trim+upper). Lo usa el ProductModal para      //
// re-resolver la Descripción DYMMSA cuando se edita el model_code.    //
// ------------------------------------------------------------------ //

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { codes } = await request.json()
    if (!Array.isArray(codes) || codes.length === 0) {
      return NextResponse.json(
        { message: 'Se requiere un array de códigos' },
        { status: 400 }
      )
    }

    const catalogMap = await fetchCatalogDescriptionMap(supabase, codes)
    const descriptions = Object.fromEntries(
      [...catalogMap.entries()].filter(([, desc]) => desc && desc.trim() !== '')
    )

    return NextResponse.json({ descriptions })
  } catch (error) {
    console.error('Urrea catalog lookup error:', error)
    return NextResponse.json(
      { message: 'Error al procesar la solicitud' },
      { status: 500 }
    )
  }
}
