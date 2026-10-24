import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import {
  fetchGitHub,
  mapIssueToTask,
  isPullRequest,
  priorityToLabel,
  isTaskPriority,
  handleGitHubError,
  type GitHubIssue,
} from '@/lib/github'
import { createTask } from '@/lib/tasks-store'

// GET /api/tasks?state=&priority=&page= — issue list; state=closed is the history.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(request.url)
    const stateParam = searchParams.get('state') ?? 'open'
    const state = ['open', 'closed', 'all'].includes(stateParam) ? stateParam : 'open'
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const priority = searchParams.get('priority')

    const qs = new URLSearchParams({
      state,
      page: String(page),
      per_page: '30',
      sort: 'created',
      direction: 'desc',
    })
    if (priority && isTaskPriority(priority)) qs.set('labels', priorityToLabel(priority))

    const issues = await fetchGitHub<GitHubIssue[]>(`/issues?${qs.toString()}`)
    // The issues API includes PRs → filter them out.
    const tasks = issues.filter((i) => !isPullRequest(i)).map(mapIssueToTask)
    return NextResponse.json({ tasks, page })
  } catch (e) {
    return handleGitHubError(e)
  }
}

// POST /api/tasks — { title, description?, priority? }
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = (await request.json()) as { title?: string; description?: string; priority?: string }
    const task = await createTask(
      {
        title: body.title ?? '',
        description: body.description,
        priority: body.priority && isTaskPriority(body.priority) ? body.priority : undefined,
      },
      user.email ?? 'DYMMSA',
    )
    return NextResponse.json(task, { status: 201 })
  } catch (e) {
    return handleGitHubError(e)
  }
}
