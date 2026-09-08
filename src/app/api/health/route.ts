import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runHealthChecks } from '@/lib/health'

// GET /api/health — public on purpose (header-less monitors): ok/degraded → 200, down → 503,
// 30s edge cache against bursts.
export async function GET() {
  const report = await runHealthChecks({ db: createAdminClient() })

  return NextResponse.json(report, {
    status: report.status === 'down' ? 503 : 200,
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' },
  })
}
