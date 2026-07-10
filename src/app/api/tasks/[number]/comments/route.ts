import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest } from '@/lib/api-helpers'
import { fetchGitHub, mapComment, buildIssueBody, handleGitHubError, type GitHubComment } from '@/lib/github'

// ------------------------------------------------------------------ //
// POST /api/tasks/[number]/comments   { body }                        //
// Agrega un comentario. Antepone "Reportado por: X" para saber quién  //
// comentó (todos los comentarios los crea el token del repo).         //
// ------------------------------------------------------------------ //
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
    if (!body?.trim()) return badRequest('El comentario no puede estar vacío')

    const created = await fetchGitHub<GitHubComment>(`/issues/${n}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: buildIssueBody(body, user.email ?? 'DYMMSA') }),
    })
    return NextResponse.json(mapComment(created), { status: 201 })
  } catch (e) {
    return handleGitHubError(e)
  }
}
