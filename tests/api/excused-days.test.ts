/** /api/excused-days (meeting 2026-10-01): anyone reads what RLS shows; only an admin adds or removes. */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, filterValue } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import { AUTH } from '../helpers/factories'
import * as excusedRoute from '@/app/api/excused-days/route'
import * as excusedById from '@/app/api/excused-days/[id]/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const DIEGO = '11111111-1111-4111-8111-111111111111'
const DAY_ID = '22222222-2222-4222-8222-222222222222'
const role = (r: 'admin' | 'member') => ({ data: { id: AUTH.id, role: r, display_name: 'Axl' }, error: null })

const post = (body: unknown) => excusedRoute.POST(makeRequest(body))

describe('GET /api/excused-days', () => {
  test('cualquiera con sesión lee (la RLS filtra) desde la fecha pedida', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'excused_days.select': { data: [{ id: DAY_ID }], error: null } } })
    const res = await excusedRoute.GET(makeRequest(undefined, { url: 'http://x/api/excused-days?from=2026-08-01' }))
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual([{ id: DAY_ID }])
    expect(filterValue(activeClient.callsTo('excused_days', 'select')[0], 'work_date', 'gte')).toBe('2026-08-01')
  })

  test('fecha inválida → 400; sin sesión → 401', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await excusedRoute.GET(makeRequest(undefined, { url: 'http://x/api/excused-days?from=ayer' }))).status).toBe(400)
    // Right shape, no such day: Postgres would answer 22008 and the route a 500 (review PR #128).
    expect((await excusedRoute.GET(makeRequest(undefined, { url: 'http://x/api/excused-days?from=2026-02-31' }))).status).toBe(400)
    expect((await excusedRoute.GET(makeRequest(undefined, { url: 'http://x/api/excused-days?to=2026-02-30' }))).status).toBe(400)
    expect(activeClient.didCall('excused_days', 'select')).toBe(false)
    activeClient = createMockSupabase({ user: null })
    expect((await excusedRoute.GET(makeRequest(undefined, { url: 'http://x/api/excused-days' }))).status).toBe(401)
  })
})

describe('POST /api/excused-days', () => {
  test('una fecha que no existe → 400 sin insertar', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': role('admin') } })
    expect((await post({ work_date: '2026-02-30', kind: 'holiday' })).status).toBe(400)
    expect(activeClient.didCall('excused_days', 'insert')).toBe(false)
  })

  test('un member → 403 sin insertar', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': role('member') } })
    expect((await post({ work_date: '2026-09-16', kind: 'holiday' })).status).toBe(403)
    expect(activeClient.didCall('excused_days', 'insert')).toBe(false)
  })

  test('el admin marca un feriado para todo el equipo', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': role('admin'), 'excused_days.insert': { data: { id: DAY_ID }, error: null } },
    })
    const res = await post({ work_date: '2026-09-16', kind: 'holiday', note: ' Independencia ' })
    expect(res.status).toBe(201)
    expect(activeClient.insertPayload('excused_days')).toEqual({ work_date: '2026-09-16', kind: 'holiday', user_id: null, note: 'Independencia' })
  })

  test('salida autorizada para una persona; persona que no es uuid → 400', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': role('admin'), 'excused_days.insert': { data: { id: DAY_ID }, error: null } },
    })
    expect((await post({ work_date: '2026-09-25', kind: 'early_release', user_id: DIEGO })).status).toBe(201)
    expect(activeClient.insertPayload('excused_days')).toMatchObject({ user_id: DIEGO, kind: 'early_release' })
    expect((await post({ work_date: '2026-09-25', kind: 'early_release', user_id: 'diego' })).status).toBe(400)
  })

  test('tipo o fecha inválidos → 400; repetido (23505) → 400 descriptivo', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': role('admin'), 'excused_days.insert': { data: null, error: { code: '23505' } } },
    })
    expect((await post({ work_date: '2026-09-16', kind: 'vacaciones' })).status).toBe(400)
    expect((await post({ work_date: '16-09-2026', kind: 'holiday' })).status).toBe(400)
    const dup = await post({ work_date: '2026-09-16', kind: 'holiday' })
    expect(dup.status).toBe(400)
    expect((await readJson<{ message: string }>(dup)).message).toMatch(/todo el equipo/)
  })
})

describe('DELETE /api/excused-days/[id]', () => {
  test('el guard corre antes de validar el id: sin sesión → 401 y member → 403 aunque el id no sea uuid', async () => {
    const del = () => excusedById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: 'no-uuid' }))
    activeClient = createMockSupabase({ user: null })
    expect((await del()).status).toBe(401)
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': role('member') } })
    expect((await del()).status).toBe(403)
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': role('admin') } })
    expect((await del()).status).toBe(404)
    expect(activeClient.didCall('excused_days', 'delete')).toBe(false)
  })

  test('un member → 403; el admin borra; inexistente → 404', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': role('member') } })
    expect((await excusedById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: DAY_ID }))).status).toBe(403)

    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': role('admin'), 'excused_days.delete': { data: [{ id: DAY_ID }], error: null } },
    })
    expect((await excusedById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: DAY_ID }))).status).toBe(200)
    expect(filterValue(activeClient.callsTo('excused_days', 'delete')[0], 'id')).toBe(DAY_ID)

    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': role('admin'), 'excused_days.delete': { data: [], error: null } },
    })
    expect((await excusedById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: DAY_ID }))).status).toBe(404)
  })
})
