import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { fetchCatalogDescriptionMap } from '@/lib/urrea-catalog'

// POST lookup — { codes } → { descriptions: Record<catalogKey, desc> }: queried by code,
// answered keyed by BRAND|CODE across ALL brands.

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
