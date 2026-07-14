import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import { fetchCatalogDescriptionMap } from '@/lib/urrea-catalog'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    // modelCodes (opcional): códigos del Excel para resolver descripciones de
    // catálogo también en filas que aún no existen en etm_products.
    const { etmCodes, modelCodes } = await request.json()

    if (!Array.isArray(etmCodes) || etmCodes.length === 0) {
      return NextResponse.json(
        { message: 'Se requiere un array de codigos ETM' },
        { status: 400 }
      )
    }

    // Busqueda masiva con filtro .in()
    const { data, error } = await supabase
      .from('etm_products')
      .select('*')
      .in('etm', etmCodes)

    if (error) {
      console.error('Lookup error:', error)
      return NextResponse.json(
        { message: 'Error en la consulta' },
        { status: 500 }
      )
    }

    // Determinar cuales ETMs no se encontraron
    const foundEtms = new Set(data?.map((p) => p.etm) || [])
    const notFound = etmCodes.filter((etm) => !foundEtms.has(etm))

    // Descripciones oficiales del catálogo (jerarquía mayor que la curada):
    // union de model_codes de los productos encontrados + los del Excel.
    // El mapa devuelto se indexa por `catalogKey` (MARCA|CODIGO) e incluye todas
    // las marcas de esos códigos → el cotizador resuelve con la marca de cada ítem.
    const codesForCatalog = [
      ...(data?.map((p) => p.model_code) ?? []),
      ...(Array.isArray(modelCodes) ? modelCodes : []),
    ]
    const catalogMap = await fetchCatalogDescriptionMap(supabase, codesForCatalog)
    const catalogDescriptions = Object.fromEntries(
      [...catalogMap.entries()].filter(([, desc]) => desc && desc.trim() !== '')
    )

    return NextResponse.json({
      found: data || [],
      notFound,
      catalogDescriptions,
    })
  } catch (error) {
    console.error('Lookup error:', error)
    return NextResponse.json(
      { message: 'Error al procesar la solicitud' },
      { status: 500 }
    )
  }
}
