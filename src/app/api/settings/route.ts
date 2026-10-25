import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError, serverError } from '@/lib/api-helpers'
import { saveSettings } from '@/lib/settings-store'

/** GET /api/settings?keys=a,b — raw rows as Record key→value. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const keysParam = request.nextUrl.searchParams.get('keys')
    let query = supabase.from('app_settings').select('key, value')
    if (keysParam) {
      query = query.in('key', keysParam.split(',').map((k) => k.trim()).filter(Boolean))
    }

    const { data, error } = await query
    if (error) {
      console.error('settings GET error:', error)
      return serverError('Error al cargar la configuración')
    }

    return NextResponse.json({
      settings: Object.fromEntries((data ?? []).map((row) => [row.key, row.value])),
    })
  } catch (error) {
    console.error('settings GET error:', error)
    return serverError()
  }
}

/** PATCH /api/settings — body { settings: { key: value } }, upsert by key (whitelist in settings-store). */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as { settings?: Record<string, unknown> }
    return NextResponse.json({ settings: await saveSettings(supabase, body.settings) })
  } catch (error) {
    return apiError(error, 'Error al guardar la configuración', 'settings PATCH error:')
  }
}
