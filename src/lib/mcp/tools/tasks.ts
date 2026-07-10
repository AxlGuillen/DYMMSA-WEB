/**
 * Tools MCP del módulo Tareas (solo lectura).
 * Misma fuente que /api/tasks: los issues del repo GITHUB_REPO vía github.ts.
 * Los GitHubError se propagan — el wrapper del server los muestra tal cual.
 */

import {
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
  // La API de issues incluye PRs → se excluyen.
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
