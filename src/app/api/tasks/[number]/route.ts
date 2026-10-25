import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest } from '@/lib/api-helpers'
import {
  fetchGitHub,
  handleGitHubError,
  mapIssueToTask,
  mapComment,
  isTaskPriority,
  type GitHubIssue,
  type GitHubComment,
} from '@/lib/github'
import { patchTask } from '@/lib/tasks-store'

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

    const updated = await patchTask(
      n,
      {
        title: typeof body.title === 'string' ? body.title : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        // An unknown priority clears the label, as it always has (null).
        priority: body.priority === undefined ? undefined : body.priority && isTaskPriority(body.priority) ? body.priority : null,
        state: body.state === 'open' || body.state === 'closed' ? body.state : undefined,
        stateReason: body.stateReason === 'not_planned' || body.stateReason === 'completed' ? body.stateReason : undefined,
      },
      auth.user.email ?? 'DYMMSA',
    )
    return NextResponse.json(updated)
  } catch (e) {
    return handleGitHubError(e)
  }
}
