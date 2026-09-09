/** /api/profile + /api/profiles: role gate (403) and the profile edits admins can make (#93). */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, filterValue, hasFilter, type CallRecord } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import { AUTH } from '../helpers/factories'
import * as profileRoute from '@/app/api/profile/route'
import * as profilesRoute from '@/app/api/profiles/route'
import * as profileById from '@/app/api/profiles/[id]/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const ME_ADMIN = { id: AUTH.id, role: 'admin', display_name: 'Axl', clock_employee_id: null }
const ME_MEMBER = { id: AUTH.id, role: 'member', display_name: 'Tania', clock_employee_id: 5 }
const OTHER = { id: 'u-diego', role: 'admin', display_name: 'Diego', clock_employee_id: 1 }

/** Simulates the profiles table: the caller by id, the target by id, and the admin count. */
function profilesTable(me: typeof ME_ADMIN, target = OTHER, adminCount = 2) {
  return (rec: CallRecord) => {
    if (hasFilter(rec, 'role')) return { data: null, error: null, count: adminCount }
    const id = filterValue(rec, 'id')
    if (id === me.id) return { data: me, error: null }
    if (id === target.id) return { data: target, error: null }
    if (rec.single) return { data: null, error: { code: 'PGRST116' } }
    return { data: [me, target], error: null }
  }
}

function patch(id: string, body: unknown) {
  return profileById.PATCH(makeRequest(body, { method: 'PATCH' }), makeParams({ id }))
}

describe('GET /api/profile', () => {
  test('devuelve el perfil propio', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': profilesTable(ME_MEMBER) } })
    const res = await profileRoute.GET()
    expect(res.status).toBe(200)
    const body = await readJson<{ role: string; clock_employee_id: number }>(res)
    expect(body.role).toBe('member')
    expect(body.clock_employee_id).toBe(5)
    expect(filterValue(activeClient.callsTo('profiles')[0], 'id')).toBe(AUTH.id)
  })

  test('404 si el perfil no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': { data: null, error: { code: 'PGRST116' } } },
    })
    const res = await profileRoute.GET()
    expect(res.status).toBe(404)
  })
})

describe('GET /api/profiles', () => {
  test('403 para un member', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': profilesTable(ME_MEMBER) } })
    const res = await profilesRoute.GET()
    expect(res.status).toBe(403)
  })

  test('admin recibe la lista', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': profilesTable(ME_ADMIN) } })
    const res = await profilesRoute.GET()
    expect(res.status).toBe(200)
    const body = await readJson<unknown[]>(res)
    expect(body).toHaveLength(2)
  })
})

describe('PATCH /api/profiles/[id]', () => {
  test('403 para un member, sin tocar la tabla', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': profilesTable(ME_MEMBER) } })
    const res = await patch(OTHER.id, { role: 'member' })
    expect(res.status).toBe(403)
    expect(activeClient.didCall('profiles', 'update')).toBe(false)
  })

  test('rol fuera del enum → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': profilesTable(ME_ADMIN) } })
    const res = await patch(OTHER.id, { role: 'owner' })
    expect(res.status).toBe(400)
  })

  test('id de checador debe ser entero ≥ 1 (o null)', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': profilesTable(ME_ADMIN) } })
    expect((await patch(OTHER.id, { clock_employee_id: 0 })).status).toBe(400)
    expect((await patch(OTHER.id, { clock_employee_id: 1.5 })).status).toBe(400)
    expect((await patch(OTHER.id, { clock_employee_id: '3' })).status).toBe(400)
  })

  test('cuerpo sin cambios → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': profilesTable(ME_ADMIN) } })
    expect((await patch(OTHER.id, {})).status).toBe(400)
  })

  test('no degrada al último admin', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': profilesTable(ME_ADMIN, OTHER, 1) },
    })
    const res = await patch(OTHER.id, { role: 'member' })
    expect(res.status).toBe(400)
    expect(activeClient.didCall('profiles', 'update')).toBe(false)
  })

  test('degrada a un admin cuando queda otro', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': profilesTable(ME_ADMIN, OTHER, 2),
        'profiles.update': { data: { ...OTHER, role: 'member' }, error: null },
      },
    })
    const res = await patch(OTHER.id, { role: 'member' })
    expect(res.status).toBe(200)
    expect(activeClient.updatePayload('profiles')).toEqual({ role: 'member' })
    expect(filterValue(activeClient.callsTo('profiles', 'update')[0], 'id')).toBe(OTHER.id)
  })

  test('id de checador duplicado (23505) → 400 descriptivo', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': profilesTable(ME_ADMIN),
        'profiles.update': { data: null, error: { code: '23505' } },
      },
    })
    const res = await patch(OTHER.id, { clock_employee_id: 5 })
    expect(res.status).toBe(400)
    const body = await readJson<{ message: string }>(res)
    expect(body.message).toMatch(/checador/)
  })

  test('null desasigna el checador y recorta el nombre', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': profilesTable(ME_ADMIN),
        'profiles.update': { data: { ...OTHER, clock_employee_id: null }, error: null },
      },
    })
    const res = await patch(OTHER.id, { clock_employee_id: null, display_name: '  Diego B.  ' })
    expect(res.status).toBe(200)
    expect(activeClient.updatePayload('profiles')).toEqual({ clock_employee_id: null, display_name: 'Diego B.' })
  })

  test('perfil inexistente → 404', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': profilesTable(ME_ADMIN) },
    })
    const res = await patch('u-nadie', { role: 'member' })
    expect(res.status).toBe(404)
  })
})
