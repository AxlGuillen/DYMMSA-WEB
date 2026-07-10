import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runHealthChecks } from '@/lib/health'

/**
 * GET /api/health — endpoint PÚBLICO de estado de la aplicación.
 *
 * Si esto responde, el deploy vive; el body dice qué funciona por dentro
 * (BD, Storage, GitHub/Tareas, páginas clave). ok/degraded → 200, down → 503
 * para que cualquier monitor lo evalúe sin parsear JSON.
 *
 * Es público a propósito (uptime monitors sin headers): las respuestas son
 * gruesas (sin errores internos) y el resultado se cachea 30s en el edge
 * (s-maxage) para que un burst de hits no multiplique los checks.
 */
export async function GET(request: NextRequest) {
  // Origin real detrás del proxy de Vercel, para el self-fetch de páginas.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost:3000'
  const proto = request.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')

  const report = await runHealthChecks({
    db: createAdminClient(),
    origin: `${proto}://${host}`,
  })

  return NextResponse.json(report, {
    status: report.status === 'down' ? 503 : 200,
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' },
  })
}
