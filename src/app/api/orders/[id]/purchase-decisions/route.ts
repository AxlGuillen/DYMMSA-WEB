import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, apiError } from '@/lib/api-helpers'
import { savePurchaseDecisions } from '@/lib/purchase-decisions-store'

/**
 * Replace-all (ADR-018): upsert BEFORE the delete — a failed cleanup leaves
 * harmless orphans instead of losing decisions (purchase-decisions-store).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as { decisions?: unknown }
    return NextResponse.json({ decisions: await savePurchaseDecisions(supabase, id, body.decisions) })
  } catch (error) {
    return apiError(error, 'Error interno', 'purchase-decisions error:')
  }
}
