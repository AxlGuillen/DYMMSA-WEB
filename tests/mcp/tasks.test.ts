/** Tools MCP de tareas — GitHub se mockea con vi.spyOn(fetch), como en tests/api/tasks.test.ts. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { listTasks, getTask } from '@/lib/mcp/tools/tasks'
import { ToolError } from '@/lib/mcp/shared'

function gh(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const issue = (over: Record<string, unknown> = {}) => ({
  number: 5, title: 'Falla X', body: 'Reportado por: axl@test.com\n\nDetalle', state: 'open',
  labels: [{ name: 'priority:high' }], created_at: '2026-07-09T10:00:00Z', closed_at: null,
  comments: 0, html_url: 'https://github.com/o/r/issues/5', ...over,
})

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  process.env.GITHUB_TOKEN = 'test-token'
  process.env.GITHUB_REPO = 'AxlGuillen/DYMMSA-WEB'
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})
afterEach(() => vi.restoreAllMocks())

describe('listTasks', () => {
  test('excluye pull requests y mapea prioridad', async () => {
    fetchSpy.mockResolvedValueOnce(
      gh(200, [issue(), { ...issue({ number: 6 }), pull_request: { url: 'x' } }]),
    )

    const result = await listTasks({ state: 'all' })

    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0]).toMatchObject({ number: 5, priority: 'high', reporter: 'axl@test.com' })
  })

  test('filtra por prioridad válida vía label', async () => {
    fetchSpy.mockResolvedValueOnce(gh(200, []))
    await listTasks({ priority: 'highest' })
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('labels=priority%3Ahighest')
  })
})

describe('getTask', () => {
  test('número inválido → ToolError sin llamar a GitHub', async () => {
    await expect(getTask(0)).rejects.toThrow(ToolError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('devuelve tarea con comentarios', async () => {
    fetchSpy
      .mockResolvedValueOnce(gh(200, issue()))
      .mockResolvedValueOnce(gh(200, [{ id: 1, body: 'Reportado por: ana@test.com\n\nUn comentario', created_at: '2026-07-09T11:00:00Z', user: { login: 'axl' } }]))

    const result = await getTask(5)

    expect(result.task.number).toBe(5)
    expect(result.comments[0]).toMatchObject({ reporter: 'ana@test.com', body: 'Un comentario' })
  })
})
