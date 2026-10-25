import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { lookupEtms } from '@/lib/quotations-store'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    // modelCodes (optional): resolves catalog descriptions for Excel rows not yet in etm_products.
    const { etmCodes, modelCodes } = await request.json()

    if (!Array.isArray(etmCodes) || etmCodes.length === 0) {
      return NextResponse.json(
        { message: 'Se requiere un array de codigos ETM' },
        { status: 400 }
      )
    }

    return NextResponse.json(await lookupEtms(supabase, etmCodes, Array.isArray(modelCodes) ? modelCodes : []))
  } catch (error) {
    return apiError(error, 'Error al procesar la solicitud', 'Lookup error:')
  }
}
