/** Task tools — same source as /api/tasks (GitHub Issues, ADR-014); the writes' rules live in tasks-store (#155 C6). */

import {
  fetchGitHub,
  isPullRequest,
  mapComment,
  mapIssueToTask,
  priorityToLabel,
  TASK_CLOSE_REASON_TOKENS,
  TASK_PRIORITY_TOKENS,
  TASK_STATE_TOKENS,
  type GitHubComment,
  type GitHubIssue,
  type Task,
  type TaskComment,
} from '@/lib/github'
import type { WritePlan } from '@/lib/mcp/core/define'
import { diff, pageResult, recordResult, writeResult } from '@/lib/mcp/core/envelope'
import { ToolError } from '@/lib/mcp/core/errors'
import { assertTaskNumber, createTask, patchTask, postTaskComment, readTaskIssue, type TaskChanges } from '@/lib/tasks-store'

/** Fixed reporter: the MCP has no logged-in user (auth is a shared token). */
const MCP_REPORTER = 'Asistente (MCP)'

export const TASK_LIST_STATES = [...TASK_STATE_TOKENS.tokens, 'todas'] as const

const PER_PAGE = 30
const EXCERPT_CHARS = 200
const COMMENTS_CAP = 100

const priorityToken = (task: Task) => (task.priority ? TASK_PRIORITY_TOKENS.toToken(task.priority) : null)

/** A task as the assistant sees it: tokens, no GitHub vocabulary. */
function taskCore(task: Task) {
  return {
    tarea: task.number,
    titulo: task.title,
    descripcion: task.description,
    prioridad: priorityToken(task),
    estado: TASK_STATE_TOKENS.toToken(task.state),
    motivo_cierre: task.closedReason ? TASK_CLOSE_REASON_TOKENS.toToken(task.closedReason) : null,
    reportada_por: task.reporter,
    creada_el: task.createdAt,
    cerrada_el: task.closedAt,
    url: task.url,
  }
}

const taskDigest = (task: Task) => ({ ...taskCore(task), comentarios: task.commentsCount })

/** In a list the description is an excerpt: get_task has the whole text. */
function listDigest(task: Task) {
  const { descripcion, ...rest } = taskDigest(task)
  return { ...rest, extracto: descripcion.length > EXCERPT_CHARS ? `${descripcion.slice(0, EXCERPT_CHARS)}…` : descripcion }
}

export interface ListTasksInput {
  estado?: string
  prioridad?: string
  pagina?: number
}

export async function listTasks(input: ListTasksInput) {
  const estado = input.estado ?? 'abierta'
  // An unknown filter is an error, never "open" in silence (#155 C1).
  const state = estado === 'todas' ? 'all' : TASK_STATE_TOKENS.toDb(estado)
  if (!state) throw new ToolError(`Estado inválido "${estado}": usa ${TASK_LIST_STATES.join(' | ')}`)
  const priority = input.prioridad === undefined ? undefined : TASK_PRIORITY_TOKENS.toDb(input.prioridad)
  if (input.prioridad !== undefined && !priority) {
    throw new ToolError(`Prioridad inválida "${input.prioridad}": usa ${TASK_PRIORITY_TOKENS.tokens.join(' | ')}`)
  }
  const pagina = Math.max(1, Math.floor(input.pagina ?? 1))

  const qs = new URLSearchParams({ state, page: String(pagina), per_page: String(PER_PAGE), sort: 'created', direction: 'desc' })
  if (priority) qs.set('labels', priorityToLabel(priority))

  const issues = await fetchGitHub<GitHubIssue[]>(`/issues?${qs.toString()}`)
  // The issues API includes PRs, so exclude them; a full page BEFORE that filter may still have a next one.
  const tasks = issues.filter((i) => !isPullRequest(i)).map(mapIssueToTask)
  return pageResult('tareas', tasks.map(listDigest), { pagina, por_pagina: PER_PAGE, hay_mas: issues.length >= PER_PAGE })
}

export async function getTask(taskNumber: number) {
  assertTaskNumber(taskNumber)
  const [issue, comments] = await Promise.all([
    fetchGitHub<GitHubIssue>(`/issues/${taskNumber}`),
    fetchGitHub<GitHubComment[]>(`/issues/${taskNumber}/comments?per_page=${COMMENTS_CAP}`),
  ])
  return recordResult(
    {
      ...taskCore(mapIssueToTask(issue)),
      comentarios: comments.map(mapComment).map((c: TaskComment) => ({
        autor: c.author,
        reportado_por: c.reporter,
        texto: c.body,
        fecha: c.createdAt,
      })),
    },
    { avisos: comments.length >= COMMENTS_CAP ? [`Solo se muestran los primeros ${COMMENTS_CAP} comentarios.`] : undefined },
  )
}

export interface SaveTaskInput {
  /** The task to change; absent = a new one. */
  tarea?: number
  titulo?: string
  descripcion?: string
  /** baja | media | alta | urgente, or ninguna to remove it. */
  prioridad?: string
  /** abierta | cerrada. */
  estado?: string
  /** completada | descartada; only when closing. */
  motivo?: string
  comentario?: string
}

type Carry =
  | { kind: 'create'; title: string; description?: string; priority?: Task['priority'] }
  | { kind: 'update'; n: number; current: GitHubIssue; changes: TaskChanges; comment: string | null }

/** The priority label a token means; «ninguna» removes it (null). */
function priorityOf(token: string): Task['priority'] {
  if (token === 'ninguna') return null
  const priority = TASK_PRIORITY_TOKENS.toDb(token)
  if (!priority) throw new ToolError(`Prioridad inválida "${token}": usa ${TASK_PRIORITY_TOKENS.tokens.join(' | ')}, o ninguna para quitarla.`)
  return priority
}

function planCreate(input: SaveTaskInput): WritePlan<Carry> {
  const title = input.titulo?.trim()
  if (!title) throw new ToolError('Para crear una tarea indica `titulo`. Para cambiar una existente indica `tarea`.')
  if (input.estado !== undefined || input.motivo !== undefined || input.comentario !== undefined) {
    throw new ToolError('Una tarea nueva solo lleva titulo, descripcion y prioridad: comentar o cerrar es sobre una existente (`tarea`).')
  }
  const priority = input.prioridad === undefined ? undefined : priorityOf(input.prioridad)
  return {
    entity: { key: 'tarea', value: { titulo: title, descripcion: input.descripcion ?? '', prioridad: priority ? TASK_PRIORITY_TOKENS.toToken(priority) : null } },
    // Only adds an issue: low risk.
    directo: true,
    fingerprint: null,
    subject: 'La tarea nueva',
    carry: { kind: 'create', title, description: input.descripcion, priority: priority ?? undefined },
  }
}

async function planUpdate(input: SaveTaskInput): Promise<WritePlan<Carry>> {
  const n = input.tarea as number
  assertTaskNumber(n)
  const comment = input.comentario?.trim() || null
  if (input.comentario !== undefined && !comment) throw new ToolError('El comentario no puede estar vacío')
  const state = input.estado === undefined ? undefined : TASK_STATE_TOKENS.toDb(input.estado)
  if (input.estado !== undefined && !state) throw new ToolError(`Estado inválido "${input.estado}": usa ${TASK_STATE_TOKENS.tokens.join(' | ')}`)
  const reason = input.motivo === undefined ? undefined : TASK_CLOSE_REASON_TOKENS.toDb(input.motivo)
  if (input.motivo !== undefined && !reason) {
    throw new ToolError(`Motivo inválido "${input.motivo}": usa ${TASK_CLOSE_REASON_TOKENS.tokens.join(' | ')}`)
  }
  if (reason && state !== 'closed') throw new ToolError('`motivo` solo va al cerrar la tarea (estado: cerrada).')
  if (input.titulo !== undefined && !input.titulo.trim()) throw new ToolError('El título no puede quedar vacío')

  const changes: TaskChanges = {
    title: input.titulo,
    description: input.descripcion,
    priority: input.prioridad === undefined ? undefined : priorityOf(input.prioridad),
    state,
    stateReason: reason,
  }
  const hasPatch = Object.values(changes).some((value) => value !== undefined)
  if (!hasPatch && !comment) {
    throw new ToolError('Indica al menos un cambio: comentario, prioridad, estado, motivo, titulo o descripcion.')
  }

  const current = await readTaskIssue(n)
  const before = mapIssueToTask(current)
  const after: Task = {
    ...before,
    title: changes.title?.trim() ?? before.title,
    description: changes.description !== undefined ? changes.description.trim() : before.description,
    priority: changes.priority === undefined ? before.priority : changes.priority,
    state: changes.state ?? before.state,
    closedReason: changes.state === 'closed' ? (changes.stateReason ?? 'completed') : changes.state === 'open' ? null : before.closedReason,
  }
  const cambios = {
    ...diff(taskDigest(before), taskDigest(after), ['tarea', 'comentarios', 'url', 'cerrada_el']),
    ...(comment ? { comentario: { antes: null, ahora: comment } } : {}),
  }
  // Rewriting human text is the one risky change (ADR-015, reopened in ADR-041 §13): it asks for the yes.
  const rewrites = changes.title !== undefined || changes.description !== undefined
  return {
    entity: { key: 'tarea', value: taskDigest(after) },
    cambios,
    directo: !rewrites,
    fingerprint: { n, title: current.title, body: current.body, state: current.state, labels: (current.labels ?? []).map((l) => l.name).sort() },
    subject: `La tarea #${n}`,
    carry: { kind: 'update', n, current, changes, comment },
  }
}

export async function planSaveTask(input: SaveTaskInput): Promise<WritePlan<Carry>> {
  return input.tarea === undefined ? planCreate(input) : planUpdate(input)
}

export async function commitSaveTask(plan: WritePlan<Carry>) {
  const carry = plan.carry
  if (carry.kind === 'create') {
    const task = await createTask({ title: carry.title, description: carry.description, priority: carry.priority ?? undefined }, MCP_REPORTER)
    return writeResult('creado', 'tarea', taskDigest(task), { nota: `Tarea #${task.number} creada, reportada por el asistente.` })
  }
  const { n, current, changes, comment } = carry
  // No rollback on purpose: deleting an already-published comment would be worse than a partial.
  if (comment) await postTaskComment(n, comment, MCP_REPORTER)
  const hasPatch = Object.values(changes).some((value) => value !== undefined)
  // A comment-only change re-reads: the comment count and the target come back fresh.
  const task = hasPatch ? await patchTask(n, changes, MCP_REPORTER, current) : mapIssueToTask(await readTaskIssue(n))
  return writeResult('actualizado', 'tarea', taskDigest(task), { cambios: plan.cambios })
}
