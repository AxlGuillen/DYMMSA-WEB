import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiError, requireAuth } from '@/lib/api-helpers'
import { nextDymmsaCode } from '@/lib/products-store'

export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    return NextResponse.json({ next: await nextDymmsaCode(supabase) })
  } catch (error) {
    return apiError(error, 'Error al leer los códigos DYMMSA', 'next-dymmsa-code error:')
  }
}
