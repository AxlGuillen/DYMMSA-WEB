/**
 * API de Tareas (GitHub Issues como backend). GitHub se mockea con
 * vi.spyOn(fetch); Supabase (auth + admin storage) con los mocks del proyecto.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams } from '../helpers/request'
import * as tasks from '@/app/api/tasks/route'
import * as taskDetail from '@/app/api/tasks/[number]/route'
import * as taskComments from '@/app/api/tasks/[number]/comments/route'
import * as taskUpload from '@/app/api/tasks/upload/route'
import { createAdminClient } from '@/lib/supabase/admin'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const AUTH = { id: 'u1', email: 'axl@test.com' } as { id: string }
const authed = () => { activeClient = createMockSupabase({ user: AUTH }) }

/** Respuesta estilo fetch para la API de GitHub. */
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

// ─── GET /api/tasks ──────────────────────────────────────────────────────────

describe('GET /api/tasks', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await tasks.GET(makeRequest(undefined, { url: 'http://localhost/api/tasks' }))
    expect(res.status).toBe(401)
  })

  test('lista tasks y EXCLUYE pull requests', async () => {
    authed()
    fetchSpy.mockResolvedValueOnce(gh(200, [issue(), { ...issue({ number: 6 }), pull_request: { url: 'x' } }]))
    const res = await tasks.GET(makeRequest(undefined, { url: 'http://localhost/api/tasks?state=all' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0]).toMatchObject({ number: 5, priority: 'high', reporter: 'axl@test.com', description: 'Detalle' })
  })

  test('filtro de prioridad agrega el label a la query', async () => {
    authed()
    fetchSpy.mockResolvedValueOnce(gh(200, []))
    await tasks.GET(makeRequest(undefined, { url: 'http://localhost/api/tasks?priority=highest' }))
    expect(String(fetchSpy.mock.calls[0][0])).toContain('labels=priority%3Ahighest')
  })

  test('token vencido (401 de GitHub) → 401 con mensaje claro', async () => {
    authed()
    fetchSpy.mockResolvedValueOnce(gh(401, {}))
    const res = await tasks.GET(makeRequest(undefined, { url: 'http://localhost/api/tasks' }))
    expect(res.status).toBe(401)
    expect((await res.json()).message).toMatch(/token/i)
  })
})

// ─── POST /api/tasks ─────────────────────────────────────────────────────────

describe('POST /api/tasks', () => {
  test('400 sin título', async () => {
    authed()
    const res = await tasks.POST(makeRequest({ description: 'x' }))
    expect(res.status).toBe(400)
  })

  test('crea issue con label de prioridad y reporter en el body', async () => {
    authed()
    fetchSpy.mockResolvedValueOnce(gh(201, issue()))
    const res = await tasks.POST(makeRequest({ title: 'Nueva', description: 'desc', priority: 'high' }))
    expect(res.status).toBe(201)
    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))
    expect(sent.title).toBe('Nueva')
    expect(sent.labels).toEqual(['priority:high'])
    expect(sent.body).toBe('Reportado por: axl@test.com\n\ndesc')
  })

  test('prioridad inválida → sin labels', async () => {
    authed()
    fetchSpy.mockResolvedValueOnce(gh(201, issue()))
    await tasks.POST(makeRequest({ title: 'Nueva', priority: 'urgentisimo' }))
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).labels).toEqual([])
  })
})

// ─── GET /api/tasks/[number] ───────────────────────────────────────────────────

describe('GET /api/tasks/[number]', () => {
  test('400 número inválido', async () => {
    authed()
    const res = await taskDetail.GET(makeRequest(), makeParams({ number: 'abc' }))
    expect(res.status).toBe(400)
  })

  test('devuelve task + comentarios', async () => {
    authed()
    fetchSpy
      .mockResolvedValueOnce(gh(200, issue()))
      .mockResolvedValueOnce(gh(200, [{ id: 1, body: 'Reportado por: María\n\nHola', created_at: '2026-07-09T11:00:00Z', user: { login: 'bot' } }]))
    const res = await taskDetail.GET(makeRequest(), makeParams({ number: '5' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.number).toBe(5)
    expect(body.comments).toEqual([{ id: 1, author: 'bot', reporter: 'María', body: 'Hola', createdAt: '2026-07-09T11:00:00Z' }])
  })
})

// ─── PATCH /api/tasks/[number] ─────────────────────────────────────────────────

describe('PATCH /api/tasks/[number]', () => {
  test('400 sin cambios', async () => {
    authed()
    const res = await taskDetail.PATCH(makeRequest({}, { method: 'PATCH' }), makeParams({ number: '5' }))
    expect(res.status).toBe(400)
  })

  test('cerrar: PATCH con state closed + state_reason completed por defecto', async () => {
    authed()
    fetchSpy.mockResolvedValueOnce(gh(200, issue({ state: 'closed' })))
    const res = await taskDetail.PATCH(makeRequest({ state: 'closed' }, { method: 'PATCH' }), makeParams({ number: '5' }))
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))
    expect(sent.state).toBe('closed')
    expect(sent.state_reason).toBe('completed')
  })

  test('descartar: state closed + state_reason not_planned', async () => {
    authed()
    fetchSpy.mockResolvedValueOnce(gh(200, issue({ state: 'closed', state_reason: 'not_planned' })))
    await taskDetail.PATCH(makeRequest({ state: 'closed', stateReason: 'not_planned' }, { method: 'PATCH' }), makeParams({ number: '5' }))
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).state_reason).toBe('not_planned')
  })

  test('reabrir: state open sin state_reason', async () => {
    authed()
    fetchSpy.mockResolvedValueOnce(gh(200, issue({ state: 'open' })))
    await taskDetail.PATCH(makeRequest({ state: 'open' }, { method: 'PATCH' }), makeParams({ number: '5' }))
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).state_reason).toBeUndefined()
  })

  test('editar descripción: lee el issue y preserva el reporter original', async () => {
    authed()
    fetchSpy
      .mockResolvedValueOnce(gh(200, issue({ body: 'Reportado por: María\n\nviejo' }))) // GET actual
      .mockResolvedValueOnce(gh(200, issue())) // PATCH
    await taskDetail.PATCH(makeRequest({ description: 'nuevo' }, { method: 'PATCH' }), makeParams({ number: '5' }))
    const patchBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body))
    expect(patchBody.body).toBe('Reportado por: María\n\nnuevo')
  })

  test('cambiar prioridad: preserva labels ajenos y reemplaza el de prioridad', async () => {
    authed()
    fetchSpy
      .mockResolvedValueOnce(gh(200, issue({ labels: [{ name: 'bug' }, { name: 'priority:low' }] })))
      .mockResolvedValueOnce(gh(200, issue()))
    await taskDetail.PATCH(makeRequest({ priority: 'highest' }, { method: 'PATCH' }), makeParams({ number: '5' }))
    expect(JSON.parse(String(fetchSpy.mock.calls[1][1]?.body)).labels).toEqual(['bug', 'priority:highest'])
  })
})

// ─── POST /api/tasks/[number]/comments ─────────────────────────────────────────

describe('POST /api/tasks/[number]/comments', () => {
  test('400 comentario vacío', async () => {
    authed()
    const res = await taskComments.POST(makeRequest({ body: '  ' }), makeParams({ number: '5' }))
    expect(res.status).toBe(400)
  })

  test('201 con "Reportado por" antepuesto', async () => {
    authed()
    fetchSpy.mockResolvedValueOnce(gh(201, { id: 9, body: 'Reportado por: axl@test.com\n\nok', created_at: '2026-07-09T12:00:00Z', user: { login: 'bot' } }))
    const res = await taskComments.POST(makeRequest({ body: 'ok' }), makeParams({ number: '5' }))
    expect(res.status).toBe(201)
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).body).toBe('Reportado por: axl@test.com\n\nok')
  })
})

// ─── POST /api/tasks/upload ────────────────────────────────────────────────────

describe('POST /api/tasks/upload', () => {
  function uploadReq(file?: File): NextRequest {
    const fd = new FormData()
    if (file) fd.set('file', file)
    return new NextRequest('http://localhost/api/tasks/upload', { method: 'POST', body: fd })
  }

  test('400 formato no permitido', async () => {
    authed()
    const res = await taskUpload.POST(uploadReq(new File(['x'], 'a.txt', { type: 'text/plain' })))
    expect(res.status).toBe(400)
  })

  test('201 devuelve URL pública', async () => {
    authed()
    vi.mocked(createAdminClient).mockReturnValue({
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          getPublicUrl: () => ({ data: { publicUrl: 'https://cdn/task-images/abc.png' } }),
        }),
      },
    } as never)
    const res = await taskUpload.POST(uploadReq(new File(['imgdata'], 'a.png', { type: 'image/png' })))
    expect(res.status).toBe(201)
    expect((await res.json()).url).toBe('https://cdn/task-images/abc.png')
  })
})
