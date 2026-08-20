/**
 * Tools MCP del módulo Tareas.
 * Misma fuente que /api/tasks: los issues del repo GITHUB_REPO vía github.ts.
 * Los GitHubError se propagan — el wrapper del server los muestra tal cual.
 *
 * Lectura: listTasks, getTask. Escritura (Fase 2, ADR-015): createTask — crear
 * un issue. Es la primera y única escritura del MCP; deliberadamente acotada a
 * tareas (un issue se cierra/borra trivialmente y no toca el núcleo transaccional).
 */

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

/** Reporter fijo de las tasks creadas por el MCP: no hay usuario logueado (auth = token compartido). */
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

export interface CreateTaskInput {
  title?: string
  description?: string
  priority?: string
}

/**
 * Crea una tarea (GitHub Issue). Espeja POST /api/tasks pero con reporter fijo
 * (ver MCP_REPORTER): el MCP no tiene sesión de usuario. Título obligatorio;
 * prioridad opcional (se ignora si no es válida, igual que la ruta HTTP).
 */
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

/**
 * Actualiza una tarea existente (issue #72, ADR-015): comentar, cambiar
 * prioridad y cerrar/reabrir. Espeja PATCH /api/tasks/[number] y el POST de
 * comentarios, con atribución fija MCP_REPORTER. Deliberadamente NO edita
 * título ni descripción: reescribir texto redactado por humanos es el riesgo
 * que esta tool acotada evita.
 */
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
  // Prioridad estricta (a diferencia de crear, aquí un typo "quitaría" la
  // prioridad en silencio): válida o "none" para removerla.
  if (wantsPriority && input.priority !== 'none' && !isTaskPriority(input.priority)) {
    throw new ToolError('priority inválida — usa low | medium | high | highest, o "none" para quitarla')
  }

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
      // Al cerrar: "completada" vs "descartada"; al reabrir GitHub fija
      // state_reason='reopened' solo (mismo contrato que la ruta HTTP).
      if (input.state === 'closed') {
        patch.state_reason = input.state_reason === 'not_planned' ? 'not_planned' : 'completed'
      }
    }
    if (wantsPriority) {
      // Leer los labels actuales para no pisar los ajenos a la prioridad.
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

  // Solo comentario: releer la tarea confirma el destino y da contexto fresco.
  const issue = await fetchGitHub<GitHubIssue>(`/issues/${n}`)
  return { task: mapIssueToTask(issue), comentario: createdComment ?? undefined }
}
