import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verificar autenticacion
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ message: 'No autorizado' }, { status: 401 })
    }

    const { etmCodes } = await request.json()

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

    return NextResponse.json({
      found: data || [],
      notFound,
    })
  } catch (error) {
    console.error('Lookup error:', error)
    return NextResponse.json(
      { message: 'Error al procesar la solicitud' },
      { status: 500 }
    )
  }
}
