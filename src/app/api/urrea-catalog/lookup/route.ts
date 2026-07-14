import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { fetchCatalogDescriptionMap } from '@/lib/urrea-catalog'

// ---------------------------------------------------------------------------- //
// POST /api/urrea-catalog/lookup                                                //
// Batch: { codes: string[] } → { descriptions: Record<catalogKey, desc> }       //
// La query es por código, pero la respuesta viene indexada por `MARCA|CODIGO`   //
// (catalogKey) e incluye TODAS las marcas de esos códigos — quien resuelve      //
// elige la de su marca. Lo usan ProductModal/ProductForm para re-resolver la    //
// Descripción DYMMSA al editar el model_code o la marca.                        //
// ---------------------------------------------------------------------------- //

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
