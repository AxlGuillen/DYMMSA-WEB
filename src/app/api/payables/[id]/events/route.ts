import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, serverError } from '@/lib/api-helpers'
import type { AuditEvent } from '@/types/database'

// GET /api/payables/[id]/events — the audit trail of one payable, newest first. Admin only:
// RLS (is_admin) + requireAdmin + the client never renders it for a member (ADR-028).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAdmin(supabase)
    if ('error' in auth) return auth.error

    const { data, error } = await supabase
      .from('audit_events')
      .select('id, action, actor_name, data, created_at')
      .eq('entity_type', 'payable')
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100)

    if (error) {
      console.error('Error fetching payable events:', error)
      return serverError('Error al obtener el historial')
    }

    return NextResponse.json((data ?? []) as AuditEvent[])
  } catch (error) {
    console.error('Payable events GET error:', error)
    return serverError('Error al obtener el historial')
  }
}
