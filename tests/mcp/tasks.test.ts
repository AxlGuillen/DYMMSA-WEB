/** Tools MCP de tareas — GitHub se mockea con vi.spyOn(fetch), como en tests/api/tasks.test.ts. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { listTasks, getTask, createTask, updateTask } from '@/lib/mcp/tools/tasks'
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

describe('createTask', () => {
  test('título vacío → ToolError sin llamar a GitHub', async () => {
    await expect(createTask({ title: '   ' })).rejects.toThrow(ToolError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('crea el issue con reporter fijo y prioridad como label', async () => {
    fetchSpy.mockResolvedValueOnce(gh(201, issue({ number: 9, title: 'Nueva tarea' })))

    const task = await createTask({ title: '  Nueva tarea  ', description: 'Detalle', priority: 'high' })

    expect(task.number).toBe(9)
    const [, init] = fetchSpy.mock.calls[0]
    expect(init?.method).toBe('POST')
    const payload = JSON.parse(String(init?.body))
    expect(payload.title).toBe('Nueva tarea')
    expect(payload.labels).toEqual(['priority:high'])
    expect(payload.body).toContain('Reportado por: Asistente (MCP)')
    expect(payload.body).toContain('Detalle')
  })

  test('prioridad inválida no agrega label', async () => {
    fetchSpy.mockResolvedValueOnce(gh(201, issue({ number: 10 })))

    await createTask({ title: 'Sin prioridad', priority: 'urgent' })

    const payload = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))
    expect(payload.labels).toEqual([])
  })
})

describe('updateTask (issue #72)', () => {
  test('sin cambios → ToolError sin llamar a GitHub', async () => {
    await expect(updateTask({ task_number: 5 })).rejects.toThrow(/al menos un cambio/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('validaciones estrictas: state y priority inválidos truenan (no fallan en silencio)', async () => {
    await expect(updateTask({ task_number: 5, state: 'done' })).rejects.toThrow(/open.*closed/)
    // A diferencia de crear, un typo aquí QUITARÍA la prioridad — se rechaza.
    await expect(updateTask({ task_number: 5, priority: 'urgent' })).rejects.toThrow(/priority inválida/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('comentar publica con atribución MCP y devuelve la tarea', async () => {
    fetchSpy
      .mockResolvedValueOnce(gh(201, { id: 9, body: 'Reportado por: Asistente (MCP)\n\nListo el pedido', created_at: '2026-08-20T10:00:00Z', user: { login: 'axl' } }))
      .mockResolvedValueOnce(gh(200, issue()))

    const result = await updateTask({ task_number: 5, comment: 'Listo el pedido' })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain('/issues/5/comments')
    expect(JSON.parse((init as RequestInit).body as string).body).toContain('Reportado por: Asistente (MCP)')
    expect(result.task.number).toBe(5)
    expect(result.comentario).toMatchObject({ reporter: 'Asistente (MCP)' })
  })

  test('cerrar como descartada manda state_reason not_planned', async () => {
    fetchSpy.mockResolvedValueOnce(gh(200, issue({ state: 'closed' })))

    await updateTask({ task_number: 5, state: 'closed', state_reason: 'not_planned' })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain('/issues/5')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ state: 'closed', state_reason: 'not_planned' })
  })

  test('cambiar prioridad conserva los labels ajenos a priority:*', async () => {
    fetchSpy
      .mockResolvedValueOnce(gh(200, issue({ labels: [{ name: 'priority:low' }, { name: 'bug' }] })))
      .mockResolvedValueOnce(gh(200, issue({ labels: [{ name: 'priority:high' }, { name: 'bug' }] })))

    await updateTask({ task_number: 5, priority: 'high' })

    const patchBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string)
    expect(patchBody.labels).toEqual(['bug', 'priority:high'])
  })

  test('priority "none" quita el label de prioridad', async () => {
    fetchSpy
      .mockResolvedValueOnce(gh(200, issue({ labels: [{ name: 'priority:high' }, { name: 'bug' }] })))
      .mockResolvedValueOnce(gh(200, issue({ labels: [{ name: 'bug' }] })))

    await updateTask({ task_number: 5, priority: 'none' })

    const patchBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string)
    expect(patchBody.labels).toEqual(['bug'])
  })

  test('comentar Y cerrar en una llamada: comment primero, luego el PATCH', async () => {
    fetchSpy
      .mockResolvedValueOnce(gh(201, { id: 9, body: 'Reportado por: Asistente (MCP)\n\nSe resolvió', created_at: '2026-08-20T10:00:00Z', user: { login: 'axl' } }))
      .mockResolvedValueOnce(gh(200, issue({ state: 'closed' })))

    const result = await updateTask({ task_number: 5, comment: 'Se resolvió', state: 'closed' })

    expect(String(fetchSpy.mock.calls[0][0])).toContain('/comments')
    expect((fetchSpy.mock.calls[1][1] as RequestInit).method).toBe('PATCH')
    expect(result.comentario).toBeDefined()
    expect(result.task.state).toBe('closed')
  })
})
