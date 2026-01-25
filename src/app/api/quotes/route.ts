import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verificar autenticacion
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ message: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '10')
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    // Obtener cotizaciones con paginacion
    const { data, error, count } = await supabase
      .from('quotes')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) {
      console.error('Get quotes error:', error)
      return NextResponse.json(
        { message: 'Error al obtener cotizaciones' },
        { status: 500 }
      )
    }

    // Obtener estadisticas generales
    const { data: statsData } = await supabase
      .from('quotes')
      .select('total_requested, total_found')

    const stats = {
      totalQuotes: count || 0,
      totalEtmsRequested: statsData?.reduce((sum, q) => sum + q.total_requested, 0) || 0,
      totalEtmsFound: statsData?.reduce((sum, q) => sum + q.total_found, 0) || 0,
    }

    return NextResponse.json({
      data: data || [],
      count: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
      stats,
    })
  } catch (error) {
    console.error('Get quotes error:', error)
    return NextResponse.json(
      { message: 'Error al procesar la solicitud' },
      { status: 500 }
    )
  }
}

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

    const body = await request.json()
    const { filename, total_requested, total_found, etm_products } = body

    // Validar campos requeridos
    if (!filename || total_requested === undefined || total_found === undefined) {
      return NextResponse.json(
        { message: 'Faltan campos requeridos' },
        { status: 400 }
      )
    }

    // Insertar cotizacion en historial
    const { data, error } = await supabase
      .from('quotes')
      .insert({
        user_id: user.id,
        filename,
        total_requested,
        total_found,
        etm_products: etm_products || [],
      })
      .select()
      .single()

    if (error) {
      console.error('Save quote error:', error)
      return NextResponse.json(
        { message: 'Error al guardar la cotizacion' },
        { status: 500 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Save quote error:', error)
    return NextResponse.json(
      { message: 'Error al procesar la solicitud' },
      { status: 500 }
    )
  }
}
