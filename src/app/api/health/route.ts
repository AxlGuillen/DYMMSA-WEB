import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runHealthChecks } from '@/lib/health'

/**
 * GET /api/health — PÚBLICO a propósito (monitors sin headers): respuestas
 * gruesas, ok/degraded → 200 y down → 503, cache edge 30s contra bursts.
 */
export async function GET() {
  const report = await runHealthChecks({ db: createAdminClient() })

  return NextResponse.json(report, {
    status: report.status === 'down' ? 503 : 200,
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' },
  })
}
