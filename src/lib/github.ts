/**
 * Cliente de la API de GitHub Issues — backend del módulo Tareas.
 *
 * Los issues del repo (`GITHUB_REPO`) SON las tasks: no hay tabla en Supabase.
 * La prioridad vive en labels `priority:<nivel>`, el estado en open/closed, y
 * "quién reportó" en una línea al inicio del body. Ver ADR-014.
 *
 * `fetchGitHub()` centraliza auth y mapeo de errores. Las funciones puras
 * (mapIssueToTask, buildIssueBody, priority helpers) son testeables sin red.
 *
 * Nota: los componentes/hooks del cliente importan de aquí SOLO con `import type`
 * (se borra en compilación) → `next/server` nunca llega al bundle del navegador.
 */

import { NextResponse } from 'next/server'

export type TaskPriority = 'low' | 'medium' | 'high' | 'highest'
export type TaskState = 'open' | 'closed'

/** Motivo del cierre: completed = se hizo; not_planned = descartada (falso positivo). */
export type TaskCloseReason = 'completed' | 'not_planned'

export interface Task {
  number: number
  title: string
  description: string // body sin la línea "Reportado por"
  priority: TaskPriority | null
  state: TaskState
  closedReason: TaskCloseReason | null // null si está abierta
  reporter: string | null
  createdAt: string
  closedAt: string | null
  commentsCount: number
  url: string // html_url del issue en GitHub
}

export interface TaskComment {
  id: number
  author: string // login de GitHub (dueño del token)
  reporter: string | null // "Reportado por" extraído del cuerpo, si aplica
  body: string
  createdAt: string
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'priority:low',
  medium: 'priority:medium',
  high: 'priority:high',
  highest: 'priority:highest',
}

const REPORTER_PREFIX = 'Reportado por:'

// ─── Prioridad ↔ label ─────────────────────────────────────────────────

export function priorityToLabel(p: TaskPriority): string {
  return PRIORITY_LABELS[p]
}

export function isTaskPriority(v: unknown): v is TaskPriority {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'highest'
}

/** Deriva la prioridad de los labels; el de mayor severidad gana si hay varios. */
export function priorityFromLabels(labels: { name: string }[]): TaskPriority | null {
  const names = new Set(labels.map((l) => l.name))
  const order: TaskPriority[] = ['highest', 'high', 'medium', 'low']
  for (const p of order) {
    if (names.has(PRIORITY_LABELS[p])) return p
  }
  return null
}

// ─── Body: "Reportado por" + descripción ───────────────────────────────

export function buildIssueBody(description: string, reporter: string): string {
  return `${REPORTER_PREFIX} ${reporter}\n\n${description.trim()}`
}

/** Separa la línea "Reportado por: X" del cuerpo → { reporter, description }. */
export function extractReporter(body: string | null): { reporter: string | null; description: string } {
  if (!body) return { reporter: null, description: '' }
  const lines = body.split('\n')
  if (lines[0]?.startsWith(REPORTER_PREFIX)) {
    const reporter = lines[0].slice(REPORTER_PREFIX.length).trim() || null
    let rest = lines.slice(1)
    if (rest[0]?.trim() === '') rest = rest.slice(1) // línea en blanco tras el reporter
    return { reporter, description: rest.join('\n').trim() }
  }
  return { reporter: null, description: body.trim() }
}

// ─── Issue → Task ──────────────────────────────────────────────────────

export interface GitHubIssue {
  number: number
  title: string
  body: string | null
  state: string
  state_reason?: string | null // 'completed' | 'not_planned' | 'reopened' | null
  labels: { name: string }[]
  created_at: string
  closed_at: string | null
  comments: number
  html_url: string
  pull_request?: unknown // presente solo si el issue es en realidad un PR
}

/** La API de issues incluye PRs; este helper los distingue para excluirlos. */
export function isPullRequest(issue: { pull_request?: unknown }): boolean {
  return issue.pull_request !== undefined
}

export function mapIssueToTask(issue: GitHubIssue): Task {
  const { reporter, description } = extractReporter(issue.body)
  const closed = issue.state === 'closed'
  return {
    number: issue.number,
    title: issue.title,
    description,
    priority: priorityFromLabels(issue.labels ?? []),
    state: closed ? 'closed' : 'open',
    closedReason: closed ? (issue.state_reason === 'not_planned' ? 'not_planned' : 'completed') : null,
    reporter,
    createdAt: issue.created_at,
    closedAt: issue.closed_at,
    commentsCount: issue.comments,
    url: issue.html_url,
  }
}

export interface GitHubComment {
  id: number
  body: string | null
  created_at: string
  user: { login: string } | null
}

export function mapComment(c: GitHubComment): TaskComment {
  const { reporter, description } = extractReporter(c.body)
  return {
    id: c.id,
    author: c.user?.login ?? 'desconocido',
    reporter,
    body: description || (c.body ?? ''),
    createdAt: c.created_at,
  }
}

// ─── fetchGitHub ───────────────────────────────────────────────────────

export class GitHubError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'GitHubError'
  }
}

export interface GitHubConfig {
  token: string
  repo: string
}

export function getGitHubConfig(): GitHubConfig | null {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO
  if (!token || !repo) return null
  return { token, repo }
}

export function explainGitHubStatus(status: number): string {
  switch (status) {
    case 401:
      return 'El token de GitHub es inválido o expiró. Genera uno nuevo y actualiza GITHUB_TOKEN.'
    case 403:
      return 'GitHub rechazó la solicitud (permisos insuficientes o límite de peticiones alcanzado).'
    case 404:
      return 'No se encontró el recurso en GitHub (revisa GITHUB_REPO o el número de tarea).'
    case 422:
      return 'GitHub no pudo procesar la solicitud (datos invalidos).'
    default:
      return `Error de GitHub (${status}).`
  }
}

/**
 * Traduce un `GitHubError` a `NextResponse` (mismo patrón que `explainPgError`
 * en `supabase-errors.ts`). Cualquier otro error → 500. Lo usan los route
 * handlers de tasks — vive aquí, no en un route.ts, para no acoplar rutas entre sí.
 */
export function handleGitHubError(e: unknown): NextResponse {
  if (e instanceof GitHubError) {
    const status = e.status >= 400 && e.status < 600 ? e.status : 502
    return NextResponse.json({ message: e.message }, { status })
  }
  console.error('Tasks GitHub error:', e)
  return NextResponse.json({ message: 'Error interno' }, { status: 500 })
}

/**
 * Wrapper de fetch a la API de GitHub del repo configurado. Lanza `GitHubError`
 * con un mensaje claro; el route handler lo traduce a HTTP. `path` es relativo
 * al repo, p. ej. `/issues?state=open`.
 */
export async function fetchGitHub<T>(
  path: string,
  init: RequestInit = {},
  config?: GitHubConfig,
): Promise<T> {
  const cfg = config ?? getGitHubConfig()
  if (!cfg) {
    throw new GitHubError('Integración con GitHub no configurada (falta GITHUB_TOKEN o GITHUB_REPO).', 500)
  }

  let res: Response
  try {
    res = await fetch(`https://api.github.com/repos/${cfg.repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...init.headers,
      },
    })
  } catch {
    throw new GitHubError('No se pudo conectar con GitHub. Revisa tu conexión.', 503)
  }

  if (!res.ok) throw new GitHubError(explainGitHubStatus(res.status), res.status)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
