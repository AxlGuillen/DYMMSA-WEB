import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runHealthChecks } from '@/lib/health'

/**
 * GET /api/health — endpoint PÚBLICO de estado de la aplicación.
 *
 * Que responda ya prueba que el deploy vive; el body dice qué funciona por
 * dentro corriendo las queries reales de cada módulo (cotizaciones, órdenes,
 * inventario) + Storage + GitHub. ok/degraded → 200, down → 503 para que
 * cualquier monitor lo evalúe sin parsear JSON.
 *
 * Es público a propósito (uptime monitors sin headers): las respuestas son
 * gruesas (sin errores internos) y el resultado se cachea 30s en el edge
 * (s-maxage) para que un burst de hits no multiplique los checks.
 */
export async function GET() {
  const report = await runHealthChecks({ db: createAdminClient() })

  return NextResponse.json(report, {
    status: report.status === 'down' ? 503 : 200,
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' },
  })
}
