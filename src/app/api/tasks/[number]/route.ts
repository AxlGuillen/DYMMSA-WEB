import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest } from '@/lib/api-helpers'
import {
  fetchGitHub,
  handleGitHubError,
  mapIssueToTask,
  mapComment,
  buildIssueBody,
  extractReporter,
  priorityToLabel,
  isTaskPriority,
  type GitHubIssue,
  type GitHubComment,
} from '@/lib/github'

// GET /api/tasks/[number] — task + comments
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ number: string }> }
) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { number } = await params
    const n = parseInt(number, 10)
    if (!Number.isInteger(n) || n < 1) return badRequest('Número de tarea inválido')

    const [issue, comments] = await Promise.all([
      fetchGitHub<GitHubIssue>(`/issues/${n}`),
      fetchGitHub<GitHubComment[]>(`/issues/${n}/comments?per_page=100`),
    ])

    return NextResponse.json({
      task: mapIssueToTask(issue),
      comments: comments.map(mapComment),
    })
  } catch (e) {
    return handleGitHubError(e)
  }
}

// PATCH — edits/closes/reopens preserving the reporter and any non-priority:* labels.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> }
) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { number } = await params
    const n = parseInt(number, 10)
    if (!Number.isInteger(n) || n < 1) return badRequest('Número de tarea inválido')

    const body = (await request.json()) as {
      title?: string
      description?: string
      priority?: string | null
      state?: string
      stateReason?: string // 'completed' | 'not_planned' (only when closing)
    }

    const patch: Record<string, unknown> = {}
    if (typeof body.title === 'string') {
      if (!body.title.trim()) return badRequest('El título no puede estar vacío')
      patch.title = body.title.trim()
    }
    if (body.state === 'open' || body.state === 'closed') {
      patch.state = body.state
      // Closing distinguishes "completed" from "discarded"; on reopen GitHub sets
      // state_reason='reopened' by itself.
      if (body.state === 'closed') {
        patch.state_reason = body.stateReason === 'not_planned' ? 'not_planned' : 'completed'
      }
    }

    const changesDescription = typeof body.description === 'string'
    const changesPriority = body.priority !== undefined

    // Description and priority need the current issue: keep the original reporter
    // and do not clobber labels unrelated to priority.
    if (changesDescription || changesPriority) {
      const current = await fetchGitHub<GitHubIssue>(`/issues/${n}`)
      if (changesDescription) {
        const { reporter } = extractReporter(current.body)
        patch.body = buildIssueBody(body.description as string, reporter ?? (auth.user.email ?? 'DYMMSA'))
      }
      if (changesPriority) {
        const others = (current.labels ?? []).map((l) => l.name).filter((name) => !name.startsWith('priority:'))
        patch.labels =
          body.priority && isTaskPriority(body.priority)
            ? [...others, priorityToLabel(body.priority)]
            : others
      }
    }

    if (Object.keys(patch).length === 0) return badRequest('No hay cambios para aplicar')

    const updated = await fetchGitHub<GitHubIssue>(`/issues/${n}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    return NextResponse.json(mapIssueToTask(updated))
  } catch (e) {
    return handleGitHubError(e)
  }
}
