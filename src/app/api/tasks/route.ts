import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest } from '@/lib/api-helpers'
import {
  fetchGitHub,
  mapIssueToTask,
  isPullRequest,
  buildIssueBody,
  priorityToLabel,
  isTaskPriority,
  handleGitHubError,
  type GitHubIssue,
} from '@/lib/github'

// ------------------------------------------------------------------ //
// GET /api/tasks?state=open|closed|all&priority=&page=                //
// Lista de tasks (issues del repo). El filtro state=closed = histórico.
// ------------------------------------------------------------------ //
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
    // La API de issues incluye PRs → se excluyen.
    const tasks = issues.filter((i) => !isPullRequest(i)).map(mapIssueToTask)
    return NextResponse.json({ tasks, page })
  } catch (e) {
    return handleGitHubError(e)
  }
}

// ------------------------------------------------------------------ //
// POST /api/tasks   { title, description?, priority? }                //
// ------------------------------------------------------------------ //
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = (await request.json()) as { title?: string; description?: string; priority?: string }
    const title = body.title?.trim()
    if (!title) return badRequest('El título es obligatorio')

    const reporter = user.email ?? 'DYMMSA'
    const labels = body.priority && isTaskPriority(body.priority) ? [priorityToLabel(body.priority)] : []

    const issue = await fetchGitHub<GitHubIssue>('/issues', {
      method: 'POST',
      body: JSON.stringify({
        title,
        body: buildIssueBody(body.description ?? '', reporter),
        labels,
      }),
    })
    return NextResponse.json(mapIssueToTask(issue), { status: 201 })
  } catch (e) {
    return handleGitHubError(e)
  }
}
