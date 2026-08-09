import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import type { CutMaterialType } from '@/types/database'

const isPositive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0

interface PresentationInput {
  material_type: CutMaterialType
  diameter_mm?: number | null
  thickness_mm?: number | null
  width_mm?: number | null
  length_mm: number
}

/**
 * POST /api/material-presentations — registra una presentación del proveedor
 * ("tengo barras de 6 m de Ø30"). El catálogo se arma solo con el uso (issue
 * #59): upsert contra el UNIQUE NULLS NOT DISTINCT, refrescando `last_used_at`
 * para que las sugerencias ordenen por lo más reciente.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as PresentationInput
    if (body.material_type !== 'tube' && body.material_type !== 'plate') {
      return badRequest('Tipo de material inválido')
    }
    if (!isPositive(body.length_mm)) {
      return badRequest('El largo comercial debe ser mayor a 0')
    }
    if (body.material_type === 'tube' && !isPositive(body.diameter_mm)) {
      return badRequest('Una presentación de tubo necesita diámetro')
    }
    if (body.material_type === 'plate' && (!isPositive(body.thickness_mm) || !isPositive(body.width_mm))) {
      return badRequest('Una presentación de placa necesita espesor y ancho')
    }

    const row = {
      material_type: body.material_type,
      diameter_mm: body.material_type === 'tube' ? body.diameter_mm : null,
      thickness_mm: body.material_type === 'plate' ? body.thickness_mm : null,
      width_mm: body.material_type === 'plate' ? body.width_mm : null,
      length_mm: body.length_mm,
      last_used_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('material_presentations')
      .upsert(row, { onConflict: 'material_type,diameter_mm,thickness_mm,width_mm,length_mm' })
      .select()
      .single()

    if (error) {
      console.error('material-presentations upsert error:', error)
      return serverError('Error al guardar la presentación')
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('material-presentations error:', error)
    return serverError()
  }
}
