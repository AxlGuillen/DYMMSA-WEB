import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import { parsePresentationInput, PRESENTATION_KEY } from '@/lib/cut-plan'

/** Postgres numerics arrive as strings from supabase-js; coerce at the boundary. */
function num(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** GET — full size catalog, most recently used first (#71). */
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase
      .from('material_presentations')
      .select('*')
      .order('last_used_at', { ascending: false })

    if (error) {
      console.error('material-presentations GET error:', error)
      return serverError('Error al cargar las medidas registradas')
    }

    return NextResponse.json({
      presentations: (data ?? []).map((p) => ({
        ...p,
        diameter_mm: num(p.diameter_mm),
        thickness_mm: num(p.thickness_mm),
        width_mm: num(p.width_mm),
        length_mm: num(p.length_mm),
      })),
    })
  } catch (error) {
    console.error('material-presentations GET error:', error)
    return serverError()
  }
}

/** POST — upsert on the UNIQUE NULLS NOT DISTINCT key + refresh last_used_at; the catalog builds itself. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const parsed = parsePresentationInput(await request.json())
    if ('error' in parsed) return badRequest(parsed.error)

    const { data, error } = await supabase
      .from('material_presentations')
      .upsert({ ...parsed.value, last_used_at: new Date().toISOString() }, { onConflict: PRESENTATION_KEY })
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
