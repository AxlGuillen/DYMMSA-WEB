/** Task writes of /api/tasks and save_task (#155 C6): GitHub Issues are the table, so the rules live here (ADR-014). */

import { DomainError, type DomainErrorKind } from '@/lib/domain-error'
import {
  buildIssueBody,
  extractReporter,
  fetchGitHub,
  isTaskPriority,
  mapComment,
  mapIssueToTask,
  priorityToLabel,
  type GitHubComment,
  type GitHubIssue,
  type Task,
  type TaskCloseReason,
  type TaskComment,
  type TaskPriority,
  type TaskState,
} from '@/lib/github'

export class TaskError extends DomainError {
  constructor(message: string, kind: DomainErrorKind = 'invalid') {
    super(message, kind)
    this.name = 'TaskError'
  }
}

export const INVALID_TASK_NUMBER = 'Número de tarea inválido'

export function assertTaskNumber(n: number): void {
  if (!Number.isInteger(n) || n < 1) throw new TaskError(INVALID_TASK_NUMBER)
}

export interface NewTask {
  title: string
  description?: string
  priority?: TaskPriority
}

export async function createTask(input: NewTask, reporter: string): Promise<Task> {
  const title = input.title.trim()
  if (!title) throw new TaskError('El título es obligatorio')
  const issue = await fetchGitHub<GitHubIssue>('/issues', {
    method: 'POST',
    body: JSON.stringify({
      title,
      body: buildIssueBody(input.description ?? '', reporter),
      labels: input.priority ? [priorityToLabel(input.priority)] : [],
    }),
  })
  return mapIssueToTask(issue)
}

export async function postTaskComment(n: number, text: string, reporter: string): Promise<TaskComment> {
  assertTaskNumber(n)
  if (!text.trim()) throw new TaskError('El comentario no puede estar vacío')
  const created = await fetchGitHub<GitHubComment>(`/issues/${n}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: buildIssueBody(text, reporter) }),
  })
  return mapComment(created)
}

export async function readTaskIssue(n: number): Promise<GitHubIssue> {
  assertTaskNumber(n)
  return fetchGitHub<GitHubIssue>(`/issues/${n}`)
}

export interface TaskChanges {
  title?: string
  description?: string
  /** null = remove the priority label. */
  priority?: TaskPriority | null
  state?: TaskState
  /** Only when closing. */
  stateReason?: TaskCloseReason
}

/**
 * PATCH /api/tasks/[number] and save_task: edits, closes or reopens keeping the original reporter and every
 * non-priority label. `current` saves the read when the caller already has the issue.
 */
export async function patchTask(n: number, changes: TaskChanges, fallbackReporter: string, current?: GitHubIssue): Promise<Task> {
  assertTaskNumber(n)
  const patch: Record<string, unknown> = {}
  if (changes.title !== undefined) {
    if (!changes.title.trim()) throw new TaskError('El título no puede estar vacío')
    patch.title = changes.title.trim()
  }
  if (changes.state !== undefined) {
    patch.state = changes.state
    // Closing distinguishes "completed" from "discarded"; on reopen GitHub sets state_reason='reopened' by itself.
    if (changes.state === 'closed') patch.state_reason = changes.stateReason === 'not_planned' ? 'not_planned' : 'completed'
  }

  // Description and priority need the issue: keep the original reporter and do not clobber unrelated labels.
  if (changes.description !== undefined || changes.priority !== undefined) {
    const issue = current ?? (await fetchGitHub<GitHubIssue>(`/issues/${n}`))
    if (changes.description !== undefined) {
      const { reporter } = extractReporter(issue.body)
      patch.body = buildIssueBody(changes.description, reporter ?? fallbackReporter)
    }
    if (changes.priority !== undefined) {
      const others = (issue.labels ?? []).map((l) => l.name).filter((name) => !name.startsWith('priority:'))
      patch.labels = changes.priority && isTaskPriority(changes.priority) ? [...others, priorityToLabel(changes.priority)] : others
    }
  }

  if (Object.keys(patch).length === 0) throw new TaskError('No hay cambios para aplicar')
  const updated = await fetchGitHub<GitHubIssue>(`/issues/${n}`, { method: 'PATCH', body: JSON.stringify(patch) })
  return mapIssueToTask(updated)
}
