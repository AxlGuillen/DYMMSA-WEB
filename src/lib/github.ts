/** GitHub Issues client = Tasks module backend (ADR-014). Client code imports from here ONLY with
 *  `import type` — next/server must never reach the bundle. */

import { NextResponse } from 'next/server'

export type TaskPriority = 'low' | 'medium' | 'high' | 'highest'
export type TaskState = 'open' | 'closed'

/** completed = done; not_planned = discarded. */
export type TaskCloseReason = 'completed' | 'not_planned'

export interface Task {
  number: number
  title: string
  description: string // body without the "Reportado por" line
  priority: TaskPriority | null
  state: TaskState
  closedReason: TaskCloseReason | null // null while open
  reporter: string | null
  createdAt: string
  closedAt: string | null
  commentsCount: number
  url: string // issue html_url
}

export interface TaskComment {
  id: number
  author: string // GitHub login (token owner)
  reporter: string | null // "Reportado por" pulled from the body, when present
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

export function priorityToLabel(p: TaskPriority): string {
  return PRIORITY_LABELS[p]
}

export function isTaskPriority(v: unknown): v is TaskPriority {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'highest'
}

/** Highest severity label wins when several are present. */
export function priorityFromLabels(labels: { name: string }[]): TaskPriority | null {
  const names = new Set(labels.map((l) => l.name))
  const order: TaskPriority[] = ['highest', 'high', 'medium', 'low']
  for (const p of order) {
    if (names.has(PRIORITY_LABELS[p])) return p
  }
  return null
}

export function buildIssueBody(description: string, reporter: string): string {
  return `${REPORTER_PREFIX} ${reporter}\n\n${description.trim()}`
}

/** Splits the "Reportado por: X" line off the body. */
export function extractReporter(body: string | null): { reporter: string | null; description: string } {
  if (!body) return { reporter: null, description: '' }
  const lines = body.split('\n')
  if (lines[0]?.startsWith(REPORTER_PREFIX)) {
    const reporter = lines[0].slice(REPORTER_PREFIX.length).trim() || null
    let rest = lines.slice(1)
    if (rest[0]?.trim() === '') rest = rest.slice(1) // blank line after the reporter
    return { reporter, description: rest.join('\n').trim() }
  }
  return { reporter: null, description: body.trim() }
}

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
  pull_request?: unknown // present only when the issue is actually a PR
}

/** The issues API also returns PRs; use this to exclude them. */
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

/** GitHubError → NextResponse (explainPgError pattern); anything else → 500. */
export function handleGitHubError(e: unknown): NextResponse {
  if (e instanceof GitHubError) {
    const status = e.status >= 400 && e.status < 600 ? e.status : 502
    return NextResponse.json({ message: e.message }, { status })
  }
  console.error('Tasks GitHub error:', e)
  return NextResponse.json({ message: 'Error interno' }, { status: 500 })
}

/** Fetch the repo API (`path` relative, e.g. `/issues`); throws GitHubError. */
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
