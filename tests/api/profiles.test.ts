/** /api/profile + /api/profiles: role gate (403), the admin edits (#93) and the self-service ones (#122). */

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

const ME_ADMIN = { id: AUTH.id, role: 'admin', display_name: 'Axl', clock_employee_id: null, avatar_path: null }
const ME_MEMBER = { id: AUTH.id, role: 'member', display_name: 'Tania', clock_employee_id: 5, avatar_path: `${AUTH.id}/a.webp` }
const OTHER = { id: 'u-diego', role: 'admin', display_name: 'Diego', clock_employee_id: 1, avatar_path: null }
const VALID_NSS = '12345678903'

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

function patchOwn(body: unknown) {
  return profileRoute.PATCH(makeRequest(body, { method: 'PATCH' }))
}

describe('GET /api/profile', () => {
  test('devuelve el perfil propio', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': profilesTable(ME_MEMBER) } })
    const res = await profileRoute.GET()
    expect(res.status).toBe(200)
    const body = await readJson<{ role: string; clock_employee_id: number; avatar_url: string | null }>(res)
    expect(body.role).toBe('member')
    expect(body.clock_employee_id).toBe(5)
    expect(body.avatar_url).toMatch(new RegExp(`/storage/v1/object/public/avatars/${AUTH.id}/a\\.webp$`))
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

  test('jornada: full_time/part_time o null; otro valor → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': profilesTable(ME_ADMIN) } })
    expect((await patch(OTHER.id, { shift: 'night' })).status).toBe(400)

    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': profilesTable(ME_ADMIN), 'profiles.update': { data: { id: OTHER.id, shift: 'part_time' }, error: null } },
    })
    expect((await patch(OTHER.id, { shift: 'part_time' })).status).toBe(200)
    expect(activeClient.updatePayload('profiles')).toEqual({ shift: 'part_time' })

    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': profilesTable(ME_ADMIN), 'profiles.update': { data: { id: OTHER.id, shift: null }, error: null } },
    })
    expect((await patch(OTHER.id, { shift: null })).status).toBe(200)
    expect(activeClient.updatePayload('profiles')).toEqual({ shift: null })
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

describe('PATCH /api/profile', () => {
  const ownUpdate = (data: unknown) =>
    createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': profilesTable(ME_MEMBER), 'profiles.update': { data, error: null } },
    })

  test('un member cambia su nombre y su NSS, solo en su propia fila', async () => {
    activeClient = ownUpdate({ ...ME_MEMBER, display_name: 'Tania Cruz', nss: VALID_NSS })
    const res = await patchOwn({ display_name: '  Tania Cruz ', nss: '1234-5678-903' })
    expect(res.status).toBe(200)
    expect(activeClient.updatePayload('profiles')).toEqual({ display_name: 'Tania Cruz', nss: VALID_NSS })
    expect(filterValue(activeClient.callsTo('profiles', 'update')[0], 'id')).toBe(AUTH.id)
  })

  test('NSS vacío lo borra', async () => {
    activeClient = ownUpdate({ ...ME_MEMBER, nss: null })
    expect((await patchOwn({ nss: '' })).status).toBe(200)
    expect(activeClient.updatePayload('profiles')).toEqual({ nss: null })
  })

  test('NSS con dígito verificador incorrecto → 400 descriptivo', async () => {
    activeClient = ownUpdate(null)
    const res = await patchOwn({ nss: '12345678904' })
    expect(res.status).toBe(400)
    expect((await readJson<{ message: string }>(res)).message).toMatch(/NSS no es válido/)
    expect(activeClient.didCall('profiles', 'update')).toBe(false)
  })

  test.each([['role', 'admin'], ['shift', 'full_time'], ['clock_employee_id', 3], ['avatar_path', 'x/y.webp']])(
    'mandar %s → 400 sin tocar la tabla',
    async (field, value) => {
      activeClient = ownUpdate(null)
      const res = await patchOwn({ display_name: 'Tania', [field]: value })
      expect(res.status).toBe(400)
      expect(activeClient.didCall('profiles', 'update')).toBe(false)
    },
  )

  test('nombre vacío o cuerpo sin cambios → 400', async () => {
    activeClient = ownUpdate(null)
    expect((await patchOwn({ display_name: '   ' })).status).toBe(400)
    expect((await patchOwn({})).status).toBe(400)
  })

  test('sin sesión → 401', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await patchOwn({ display_name: 'X' })).status).toBe(401)
  })
})

describe('PATCH /api/profiles/[id] — NSS', () => {
  test('el admin captura el NSS de otro, normalizado', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': profilesTable(ME_ADMIN), 'profiles.update': { data: { ...OTHER, nss: VALID_NSS }, error: null } },
    })
    const res = await patch(OTHER.id, { nss: '123 4567 8903' })
    expect(res.status).toBe(200)
    expect(activeClient.updatePayload('profiles')).toEqual({ nss: VALID_NSS })
  })

  test('NSS inválido → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': profilesTable(ME_ADMIN) } })
    expect((await patch(OTHER.id, { nss: '123' })).status).toBe(400)
  })
})
