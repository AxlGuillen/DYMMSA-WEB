import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest } from '@/lib/api-helpers'
import { handleGitHubError } from '@/lib/github'
import { postTaskComment } from '@/lib/tasks-store'

// POST comments — prepends "Reportado por: X"; every comment is created by the repo token.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> }
) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error
    const { user } = auth

    const { number } = await params
    const n = parseInt(number, 10)
    if (!Number.isInteger(n) || n < 1) return badRequest('Número de tarea inválido')

    const { body } = (await request.json()) as { body?: string }
    return NextResponse.json(await postTaskComment(n, body ?? '', user.email ?? 'DYMMSA'), { status: 201 })
  } catch (e) {
    return handleGitHubError(e)
  }
}
