/**
 * Cliente GitHub — funciones puras (mapeo issue↔task, prioridad, reporter).
 * La red (fetchGitHub) se cubre en tests/api con fetch mockeado.
 */

import { describe, test, expect } from 'vitest'
import {
  priorityToLabel,
  priorityFromLabels,
  isTaskPriority,
  buildIssueBody,
  extractReporter,
  isPullRequest,
  mapIssueToTask,
  mapComment,
  explainGitHubStatus,
  type GitHubIssue,
} from '@/lib/github'

describe('prioridad ↔ label', () => {
  test('priorityToLabel', () => {
    expect(priorityToLabel('highest')).toBe('priority:highest')
    expect(priorityToLabel('low')).toBe('priority:low')
  })

  test('priorityFromLabels: el de mayor severidad gana', () => {
    expect(priorityFromLabels([{ name: 'priority:low' }, { name: 'priority:high' }])).toBe('high')
    expect(priorityFromLabels([{ name: 'priority:highest' }, { name: 'priority:medium' }])).toBe('highest')
  })

  test('priorityFromLabels: sin label de prioridad → null (ignora otros labels)', () => {
    expect(priorityFromLabels([{ name: 'bug' }, { name: 'wontfix' }])).toBeNull()
    expect(priorityFromLabels([])).toBeNull()
  })

  test('isTaskPriority', () => {
    expect(isTaskPriority('high')).toBe(true)
    expect(isTaskPriority('urgent')).toBe(false)
    expect(isTaskPriority(null)).toBe(false)
  })
})

describe('reporter en el body', () => {
  test('buildIssueBody antepone la línea de reporter', () => {
    expect(buildIssueBody('Falla el login', 'Axl')).toBe('Reportado por: Axl\n\nFalla el login')
  })

  test('extractReporter separa reporter y descripción', () => {
    const r = extractReporter('Reportado por: Axl\n\nFalla el login\ncon detalle')
    expect(r).toEqual({ reporter: 'Axl', description: 'Falla el login\ncon detalle' })
  })

  test('extractReporter sin línea de reporter → reporter null, body intacto', () => {
    expect(extractReporter('Solo descripción')).toEqual({ reporter: null, description: 'Solo descripción' })
  })

  test('extractReporter con body vacío/null', () => {
    expect(extractReporter(null)).toEqual({ reporter: null, description: '' })
    expect(extractReporter('')).toEqual({ reporter: null, description: '' })
  })

  test('roundtrip build → extract', () => {
    const body = buildIssueBody('Descripción con\nsaltos', 'María')
    expect(extractReporter(body)).toEqual({ reporter: 'María', description: 'Descripción con\nsaltos' })
  })
})

describe('isPullRequest', () => {
  test('true solo si trae pull_request', () => {
    expect(isPullRequest({ pull_request: { url: 'x' } })).toBe(true)
    expect(isPullRequest({})).toBe(false)
  })
})

describe('mapIssueToTask', () => {
  const issue: GitHubIssue = {
    number: 42,
    title: 'Arreglar el total',
    body: 'Reportado por: Axl\n\nEl total no suma bien',
    state: 'open',
    labels: [{ name: 'priority:high' }],
    created_at: '2026-07-09T10:00:00Z',
    closed_at: null,
    comments: 3,
    html_url: 'https://github.com/o/r/issues/42',
  }

  test('mapea todos los campos', () => {
    expect(mapIssueToTask(issue)).toEqual({
      number: 42,
      title: 'Arreglar el total',
      description: 'El total no suma bien',
      priority: 'high',
      state: 'open',
      closedReason: null,
      reporter: 'Axl',
      createdAt: '2026-07-09T10:00:00Z',
      closedAt: null,
      commentsCount: 3,
      url: 'https://github.com/o/r/issues/42',
    })
  })

  test('estado closed y sin prioridad → closedReason completed por defecto', () => {
    const t = mapIssueToTask({ ...issue, state: 'closed', labels: [], closed_at: '2026-07-10T00:00:00Z' })
    expect(t.state).toBe('closed')
    expect(t.priority).toBeNull()
    expect(t.closedAt).toBe('2026-07-10T00:00:00Z')
    expect(t.closedReason).toBe('completed')
  })

  test('closed con state_reason not_planned → descartada', () => {
    const t = mapIssueToTask({ ...issue, state: 'closed', state_reason: 'not_planned' })
    expect(t.closedReason).toBe('not_planned')
  })

  test('abierta → closedReason null aunque venga state_reason', () => {
    expect(mapIssueToTask({ ...issue, state: 'open', state_reason: 'reopened' }).closedReason).toBeNull()
  })
})

describe('mapComment', () => {
  test('extrae autor y reporter', () => {
    const c = mapComment({
      id: 7,
      body: 'Reportado por: María\n\nYa lo revisé',
      created_at: '2026-07-09T12:00:00Z',
      user: { login: 'axl-bot' },
    })
    expect(c).toEqual({
      id: 7,
      author: 'axl-bot',
      reporter: 'María',
      body: 'Ya lo revisé',
      createdAt: '2026-07-09T12:00:00Z',
    })
  })

  test('user null → autor "desconocido"; sin reporter usa el body crudo', () => {
    const c = mapComment({ id: 8, body: 'comentario suelto', created_at: '2026-07-09T12:00:00Z', user: null })
    expect(c.author).toBe('desconocido')
    expect(c.reporter).toBeNull()
    expect(c.body).toBe('comentario suelto')
  })
})

describe('explainGitHubStatus', () => {
  test('mensajes por código', () => {
    expect(explainGitHubStatus(401)).toMatch(/token/i)
    expect(explainGitHubStatus(403)).toMatch(/permisos|límite/i)
    expect(explainGitHubStatus(404)).toMatch(/no se encontró/i)
    expect(explainGitHubStatus(500)).toMatch(/500/)
  })
})
