/** Task tools — same source as /api/tasks (GitHub Issues, ADR-014). */

import {
  buildIssueBody,
  fetchGitHub,
  isPullRequest,
  isTaskPriority,
  mapComment,
  mapIssueToTask,
  priorityToLabel,
  type GitHubComment,
  type GitHubIssue,
} from '@/lib/github'
import { ToolError } from '../shared'

/** Fixed reporter: the MCP has no logged-in user (auth is a shared token). */
const MCP_REPORTER = 'Asistente (MCP)'

export interface ListTasksInput {
  state?: string
  priority?: string
  page?: number
}

export async function listTasks(input: ListTasksInput) {
  const state = ['open', 'closed', 'all'].includes(input.state ?? '') ? (input.state as string) : 'open'
  const page = Math.max(1, Math.floor(input.page ?? 1))

  const qs = new URLSearchParams({
    state,
    page: String(page),
    per_page: '30',
    sort: 'created',
    direction: 'desc',
  })
  if (input.priority && isTaskPriority(input.priority)) {
    qs.set('labels', priorityToLabel(input.priority))
  }

  const issues = await fetchGitHub<GitHubIssue[]>(`/issues?${qs.toString()}`)
  // The issues API includes PRs, so exclude them.
  const tasks = issues.filter((i) => !isPullRequest(i)).map(mapIssueToTask)
  return { tasks, page, state }
}

export async function getTask(taskNumber: number) {
  if (!Number.isInteger(taskNumber) || taskNumber < 1) {
    throw new ToolError('Número de tarea inválido')
  }

  const [issue, comments] = await Promise.all([
    fetchGitHub<GitHubIssue>(`/issues/${taskNumber}`),
    fetchGitHub<GitHubComment[]>(`/issues/${taskNumber}/comments?per_page=100`),
  ])

  return {
    task: mapIssueToTask(issue),
    comments: comments.map(mapComment),
  }
}

export interface CreateTaskInput {
  title?: string
  description?: string
  priority?: string
}

/** Mirrors POST /api/tasks; an invalid priority is ignored. */
export async function createTask(input: CreateTaskInput) {
  const title = input.title?.trim()
  if (!title) throw new ToolError('El título es obligatorio')

  const labels = input.priority && isTaskPriority(input.priority) ? [priorityToLabel(input.priority)] : []

  const issue = await fetchGitHub<GitHubIssue>('/issues', {
    method: 'POST',
    body: JSON.stringify({
      title,
      body: buildIssueBody(input.description ?? '', MCP_REPORTER),
      labels,
    }),
  })

  return mapIssueToTask(issue)
}

export interface UpdateTaskInput {
  task_number: number
  comment?: string
  priority?: string
  state?: string
  state_reason?: string
}

/** Comment / prioritize / close-reopen (#72, ADR-015). Never edits title or body: rewriting human text is the risk this tool avoids. */
export async function updateTask(input: UpdateTaskInput) {
  const n = input.task_number
  if (!Number.isInteger(n) || n < 1) throw new ToolError('Número de tarea inválido')

  const comment = input.comment?.trim()
  const wantsPriority = input.priority !== undefined
  const wantsState = input.state !== undefined

  if (!comment && !wantsPriority && !wantsState) {
    throw new ToolError('Indica al menos un cambio: comment, priority o state')
  }
  if (wantsState && input.state !== 'open' && input.state !== 'closed') {
    throw new ToolError('state inválido — usa "open" o "closed"')
  }
  // Strict here (unlike create): a typo would silently drop the priority.
  if (wantsPriority && input.priority !== 'none' && !isTaskPriority(input.priority)) {
    throw new ToolError('priority inválida — usa low | medium | high | highest, o "none" para quitarla')
  }

  // No rollback on purpose: deleting an already-published comment would be worse than a partial.
  let createdComment = null
  if (comment) {
    const raw = await fetchGitHub<GitHubComment>(`/issues/${n}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: buildIssueBody(comment, MCP_REPORTER) }),
    })
    createdComment = mapComment(raw)
  }

  if (wantsPriority || wantsState) {
    const patch: Record<string, unknown> = {}
    if (wantsState) {
      patch.state = input.state
      // On reopen GitHub sets state_reason='reopened' itself (same contract as the HTTP route).
      if (input.state === 'closed') {
        patch.state_reason = input.state_reason === 'not_planned' ? 'not_planned' : 'completed'
      }
    }
    if (wantsPriority) {
      // Read current labels so non-priority ones survive.
      const current = await fetchGitHub<GitHubIssue>(`/issues/${n}`)
      const others = (current.labels ?? []).map((l) => l.name).filter((name) => !name.startsWith('priority:'))
      patch.labels = input.priority !== 'none' && isTaskPriority(input.priority)
        ? [...others, priorityToLabel(input.priority)]
        : others
    }
    const updated = await fetchGitHub<GitHubIssue>(`/issues/${n}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    return { task: mapIssueToTask(updated), comentario: createdComment ?? undefined }
  }

  // Comment-only: re-reading confirms the target and returns fresh context.
  const issue = await fetchGitHub<GitHubIssue>(`/issues/${n}`)
  return { task: mapIssueToTask(issue), comentario: createdComment ?? undefined }
}
