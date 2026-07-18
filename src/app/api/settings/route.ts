import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'
import { SETTING_THRESHOLD_MONEY, SETTING_THRESHOLD_PCT } from '@/lib/purchase-plan'

/**
 * Configuración key-value (`app_settings`). Sin seeds: los callers mergean
 * con sus defaults en código (ej. resolveThresholds) — fila ausente → default.
 *
 * PATCH con whitelist ESTRICTA por key: app_settings no es un basurero
 * genérico; cada key nueva se registra aquí con su validador.
 */
const SETTING_VALIDATORS: Record<string, (value: unknown) => boolean> = {
  // Dinero parado (MXN) — número finito > 0
  [SETTING_THRESHOLD_MONEY]: (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
  // Fracción del paquete extra — número finito en (0, 1]
  [SETTING_THRESHOLD_PCT]: (v) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1,
}

/** GET /api/settings?keys=a,b — filas crudas (Record key→value). */
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

/** PATCH /api/settings — body { settings: { key: value } }, upsert por key. */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as { settings?: Record<string, unknown> }
    const entries = Object.entries(body.settings ?? {})
    if (entries.length === 0) {
      return badRequest('El body debe incluir "settings" con al menos una key')
    }

    for (const [key, value] of entries) {
      const validate = SETTING_VALIDATORS[key]
      if (!validate) return badRequest(`Configuración desconocida: "${key}"`)
      if (!validate(value)) return badRequest(`Valor inválido para "${key}"`)
    }

    const { error } = await supabase
      .from('app_settings')
      .upsert(
        entries.map(([key, value]) => ({ key, value })),
        { onConflict: 'key' },
      )

    if (error) {
      console.error('settings PATCH error:', error)
      return serverError('Error al guardar la configuración')
    }

    return NextResponse.json({ settings: body.settings })
  } catch (error) {
    console.error('settings PATCH error:', error)
    return serverError()
  }
}
