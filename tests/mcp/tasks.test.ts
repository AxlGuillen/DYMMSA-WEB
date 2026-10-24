/** MCP task tools — GitHub is mocked with vi.spyOn(fetch), as in tests/api/tasks.test.ts. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { listTasks, getTask, planSaveTask, commitSaveTask, type SaveTaskInput } from '@/lib/mcp/tools/tasks'

function gh(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const issue = (over: Record<string, unknown> = {}) => ({
  number: 5, title: 'Falla X', body: 'Reportado por: axl@test.com\n\nDetalle', state: 'open',
  labels: [{ name: 'priority:high' }], created_at: '2026-07-09T10:00:00Z', closed_at: null,
  comments: 0, html_url: 'https://github.com/o/r/issues/5', ...over,
})
const comment = (text: string) => ({ id: 9, body: `Reportado por: Asistente (MCP)\n\n${text}`, created_at: '2026-08-20T10:00:00Z', user: { login: 'axl' } })

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  process.env.GITHUB_TOKEN = 'test-token'
  process.env.GITHUB_REPO = 'AxlGuillen/DYMMSA-WEB'
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})
afterEach(() => vi.restoreAllMocks())

const bodyOf = (call: number) => JSON.parse(String((fetchSpy.mock.calls[call][1] as RequestInit).body))
const methodOf = (call: number) => (fetchSpy.mock.calls[call][1] as RequestInit | undefined)?.method ?? 'GET'

describe('listTasks', () => {
  test('excluye pull requests, mapea prioridad y estado a tokens y recorta la descripción', async () => {
    const long = `Reportado por: axl@test.com\n\n${'x'.repeat(300)}`
    fetchSpy.mockResolvedValueOnce(gh(200, [issue({ body: long }), { ...issue({ number: 6 }), pull_request: { url: 'x' } }]))

    const result = await listTasks({ estado: 'todas' })

    expect(result.tareas).toHaveLength(1)
    expect(result.tareas[0]).toMatchObject({ tarea: 5, prioridad: 'alta', estado: 'abierta', reportada_por: 'axl@test.com' })
    expect(result.tareas[0].extracto).toHaveLength(201)
    expect(result.tareas[0]).not.toHaveProperty('descripcion')
    expect(result).toMatchObject({ pagina: 1, por_pagina: 30, hay_mas: false })
    expect(new URL(String(fetchSpy.mock.calls[0][0])).searchParams.get('state')).toBe('all')
  })

  test('una página llena avisa que hay más; filtra por prioridad vía label; estado y prioridad inválidos son error', async () => {
    fetchSpy.mockResolvedValueOnce(gh(200, Array.from({ length: 30 }, (_, i) => issue({ number: i + 1 }))))
    const full = await listTasks({ prioridad: 'urgente' })
    expect(String(fetchSpy.mock.calls[0][0])).toContain('labels=priority%3Ahighest')
    expect(full).toMatchObject({ hay_mas: true, nota: 'Hay más: pide pagina=2.' })

    await expect(listTasks({ estado: 'open' })).rejects.toThrow('Estado inválido "open": usa abierta | cerrada | todas')
    await expect(listTasks({ prioridad: 'high' })).rejects.toThrow(/Prioridad inválida "high": usa baja \| media \| alta \| urgente/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('getTask', () => {
  test('número inválido → ToolError sin llamar a GitHub', async () => {
    // A DomainError from tasks-store: the core answers it like a ToolError.
    await expect(getTask(0)).rejects.toThrow('Número de tarea inválido')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('devuelve la tarea con sus comentarios, sin el contador duplicado', async () => {
    fetchSpy
      .mockResolvedValueOnce(gh(200, issue({ state: 'closed', state_reason: 'not_planned', closed_at: '2026-08-01T00:00:00Z' })))
      .mockResolvedValueOnce(gh(200, [{ id: 1, body: 'Reportado por: ana@test.com\n\nUn comentario', created_at: '2026-07-09T11:00:00Z', user: { login: 'axl' } }]))

    const result = await getTask(5)

    expect(result).toMatchObject({ tarea: 5, estado: 'cerrada', motivo_cierre: 'descartada', prioridad: 'alta' })
    expect(result.comentarios).toEqual([{ autor: 'axl', reportado_por: 'ana@test.com', texto: 'Un comentario', fecha: '2026-07-09T11:00:00Z' }])
    expect(result.avisos).toBeUndefined()
  })

  test('con 100 comentarios avisa que puede haber más', async () => {
    fetchSpy
      .mockResolvedValueOnce(gh(200, issue()))
      .mockResolvedValueOnce(gh(200, Array.from({ length: 100 }, (_, i) => ({ id: i, body: 'x', created_at: '', user: { login: 'axl' } }))))
    expect((await getTask(5)).avisos).toEqual(['Solo se muestran los primeros 100 comentarios.'])
  })
})

/** What the core does with a direct call: plan, then commit. */
async function direct(input: SaveTaskInput) {
  const plan = await planSaveTask(input)
  expect(plan.directo, 'debía ser directa').toBe(true)
  return commitSaveTask(plan)
}

describe('save_task: crear (antes create_task)', () => {
  test('crea el issue con reporter fijo y prioridad como label; directo', async () => {
    fetchSpy.mockResolvedValueOnce(gh(201, issue({ number: 9, title: 'Nueva tarea' })))

    const result = await direct({ titulo: '  Nueva tarea  ', descripcion: 'Detalle', prioridad: 'alta' })

    expect(result).toMatchObject({ accion: 'creado', escrito: true, tarea: { tarea: 9 } })
    expect(methodOf(0)).toBe('POST')
    expect(bodyOf(0)).toMatchObject({ title: 'Nueva tarea', labels: ['priority:high'] })
    expect(bodyOf(0).body).toContain('Reportado por: Asistente (MCP)')
    expect(bodyOf(0).body).toContain('Detalle')
  })

  test('sin prioridad no agrega label', async () => {
    fetchSpy.mockResolvedValueOnce(gh(201, issue({ number: 10 })))
    await direct({ titulo: 'Sin prioridad' })
    expect(bodyOf(0).labels).toEqual([])
  })

  test('título vacío, prioridad inválida o campos de una existente: error sin llamar a GitHub', async () => {
    await expect(planSaveTask({ titulo: '   ' })).rejects.toThrow(/indica `titulo`/)
    await expect(planSaveTask({ descripcion: 'x' })).rejects.toThrow(/indica `titulo`/)
    await expect(planSaveTask({ titulo: 'Con prioridad rara', prioridad: 'urgent' })).rejects.toThrow('Prioridad inválida "urgent": usa baja | media | alta | urgente, o ninguna para quitarla.')
    await expect(planSaveTask({ titulo: 'Nueva', prioridad: 'ninguna' })).resolves.toBeDefined()
    await expect(planSaveTask({ titulo: 'Nueva', comentario: 'hola' })).rejects.toThrow(/solo lleva titulo, descripcion y prioridad/)
    await expect(planSaveTask({ titulo: 'Nueva', estado: 'cerrada' })).rejects.toThrow(/solo lleva titulo/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('save_task: cambiar una existente (antes update_task, issue #72)', () => {
  test('sin cambios, estado o motivo inválidos: error; el plan lee la tarea solo cuando ya hay algo que cambiar', async () => {
    await expect(planSaveTask({ tarea: 5 })).rejects.toThrow(/al menos un cambio/)
    await expect(planSaveTask({ tarea: 5, estado: 'done' })).rejects.toThrow(/Estado inválido "done": usa abierta \| cerrada/)
    // Unlike creating, a typo here would REMOVE the priority — so it is rejected.
    await expect(planSaveTask({ tarea: 5, prioridad: 'high' })).rejects.toThrow(/Prioridad inválida/)
    await expect(planSaveTask({ tarea: 5, motivo: 'descartada' })).rejects.toThrow(/solo va al cerrar/)
    await expect(planSaveTask({ tarea: 5, motivo: 'nunca', estado: 'cerrada' })).rejects.toThrow(/Motivo inválido/)
    await expect(planSaveTask({ tarea: 5, comentario: '  ' })).rejects.toThrow(/comentario no puede estar vacío/)
    await expect(planSaveTask({ tarea: 0, comentario: 'x' })).rejects.toThrow(/Número de tarea inválido/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('comentar publica con atribución MCP, vuelve a leer la tarea y trae el comentario en cambios', async () => {
    fetchSpy
      .mockResolvedValueOnce(gh(200, issue()))
      .mockResolvedValueOnce(gh(201, comment('Listo el pedido')))
      .mockResolvedValueOnce(gh(200, issue({ comments: 1 })))

    const result = await direct({ tarea: 5, comentario: 'Listo el pedido' })

    expect(String(fetchSpy.mock.calls[1][0])).toContain('/issues/5/comments')
    expect(bodyOf(1).body).toContain('Reportado por: Asistente (MCP)')
    expect(result).toMatchObject({ accion: 'actualizado', escrito: true, tarea: { tarea: 5, comentarios: 1 } })
    expect(result.cambios).toEqual({ comentario: { antes: null, ahora: 'Listo el pedido' } })
  })

  test('cerrar como descartada manda state_reason not_planned', async () => {
    fetchSpy.mockResolvedValueOnce(gh(200, issue())).mockResolvedValueOnce(gh(200, issue({ state: 'closed', state_reason: 'not_planned' })))

    const result = await direct({ tarea: 5, estado: 'cerrada', motivo: 'descartada' })

    expect(String(fetchSpy.mock.calls[1][0])).toContain('/issues/5')
    expect(bodyOf(1)).toEqual({ state: 'closed', state_reason: 'not_planned' })
    expect(result.cambios).toMatchObject({ estado: { antes: 'abierta', ahora: 'cerrada' }, motivo_cierre: { antes: null, ahora: 'descartada' } })
    expect(result.tarea).toMatchObject({ estado: 'cerrada', motivo_cierre: 'descartada' })
  })

  test('cambiar prioridad conserva los labels ajenos a priority:* (con lo que el plan ya leyó)', async () => {
    fetchSpy
      .mockResolvedValueOnce(gh(200, issue({ labels: [{ name: 'priority:low' }, { name: 'bug' }] })))
      .mockResolvedValueOnce(gh(200, issue({ labels: [{ name: 'priority:high' }, { name: 'bug' }] })))

    const result = await direct({ tarea: 5, prioridad: 'alta' })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(bodyOf(1).labels).toEqual(['bug', 'priority:high'])
    expect(result.cambios).toEqual({ prioridad: { antes: 'baja', ahora: 'alta' } })
  })

  test('prioridad "ninguna" quita el label de prioridad', async () => {
    fetchSpy
      .mockResolvedValueOnce(gh(200, issue({ labels: [{ name: 'priority:high' }, { name: 'bug' }] })))
      .mockResolvedValueOnce(gh(200, issue({ labels: [{ name: 'bug' }] })))

    await direct({ tarea: 5, prioridad: 'ninguna' })

    expect(bodyOf(1).labels).toEqual(['bug'])
  })

  test('comentar Y cerrar en una llamada: comentario primero, luego el PATCH', async () => {
    fetchSpy
      .mockResolvedValueOnce(gh(200, issue()))
      .mockResolvedValueOnce(gh(201, comment('Se resolvió')))
      .mockResolvedValueOnce(gh(200, issue({ state: 'closed' })))

    const result = await direct({ tarea: 5, comentario: 'Se resolvió', estado: 'cerrada' })

    expect(String(fetchSpy.mock.calls[1][0])).toContain('/comments')
    expect(methodOf(2)).toBe('PATCH')
    expect(result.tarea).toMatchObject({ estado: 'cerrada' })
    expect(result.cambios).toMatchObject({ comentario: { ahora: 'Se resolvió' }, estado: { antes: 'abierta', ahora: 'cerrada' } })
  })
})

describe('save_task: título o descripción pide el sí (ADR-015 reabierto, ADR-041 §13)', () => {
  test('el plan no es directo, muestra antes y ahora, no escribe y trae la huella de lo leído', async () => {
    fetchSpy.mockResolvedValueOnce(gh(200, issue()))

    const plan = await planSaveTask({ tarea: 5, titulo: '  Falla Y  ', descripcion: 'Nuevo detalle' })

    expect(plan.directo).toBe(false)
    expect(plan.cambios).toEqual({
      titulo: { antes: 'Falla X', ahora: 'Falla Y' },
      descripcion: { antes: 'Detalle', ahora: 'Nuevo detalle' },
    })
    expect(plan.subject).toBe('La tarea #5')
    expect(plan.fingerprint).toMatchObject({ n: 5, title: 'Falla X', state: 'open', labels: ['priority:high'] })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('al confirmar reescribe conservando al reportero original', async () => {
    fetchSpy.mockResolvedValueOnce(gh(200, issue())).mockResolvedValueOnce(gh(200, issue({ title: 'Falla Y', body: 'Reportado por: axl@test.com\n\nNuevo detalle' })))

    const result = await commitSaveTask(await planSaveTask({ tarea: 5, titulo: 'Falla Y', descripcion: 'Nuevo detalle' }))

    expect(bodyOf(1)).toEqual({ title: 'Falla Y', body: 'Reportado por: axl@test.com\n\nNuevo detalle' })
    expect(result).toMatchObject({ accion: 'actualizado', tarea: { titulo: 'Falla Y', descripcion: 'Nuevo detalle' } })
  })

  test('un título vacío es error antes de leer GitHub', async () => {
    await expect(planSaveTask({ tarea: 5, titulo: '   ' })).rejects.toThrow(/título no puede quedar vacío/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
