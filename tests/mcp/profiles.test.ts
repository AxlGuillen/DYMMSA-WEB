/** MCP list_profiles (#122, #155 C6): read-only, NSS included; RLS decides who sees whom — the mock plays the policy. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue, type CallRecord } from '../helpers/supabase-mock'
import type { Db } from '@/lib/mcp/core/db'
import { listProfiles } from '@/lib/mcp/tools/profiles'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

const U_TANIA = 'a1b2c3d4-0000-4000-8000-000000000001'
const U_DIEGO = 'd1e2f3a4-0000-4000-8000-000000000002'
const TANIA = { id: U_TANIA, display_name: 'Tania', role: 'member', area: 'office', clock_employee_id: 5, shift: 'part_time', nss: '12345678903', avatar_path: `${U_TANIA}/a.webp`, is_owner: false }
const DIEGO = { id: U_DIEGO, display_name: 'Diego', role: 'admin', area: 'workshop', clock_employee_id: 1, shift: null, nss: null, avatar_path: null, is_owner: true }

function profiles(visible: (typeof TANIA | typeof DIEGO)[]) {
  return (rec: CallRecord) => {
    const id = filterValue(rec, 'id')
    if (id) {
      const row = visible.find((p) => p.id === id) ?? null
      return { data: row, error: row ? null : { code: 'PGRST116' } }
    }
    const ref = filterValue(rec, 'id', 'gte') as string | undefined
    if (ref) return { data: visible.filter((p) => p.id.startsWith(ref.slice(0, 8))), error: null }
    const like = rec.filters.find((f) => f.method === 'ilike')?.args[1] as string | undefined
    const needle = like?.replace(/%/g, '').toLowerCase() ?? ''
    return { data: visible.filter((p) => p.display_name.toLowerCase().includes(needle)), error: null }
  }
}

describe('list_profiles', () => {
  test('member sin persona: solo su perfil, con NSS, y rol, área y jornada en tokens', async () => {
    const client = createMockSupabase({ responses: { 'profiles.select': profiles([TANIA]) } })
    const result = await listProfiles(asDb(client), U_TANIA)
    expect(result).toMatchObject({ total: 1, pagina: 1, hay_mas: false })
    expect(result.perfiles[0]).toMatchObject({
      ref: 'a1b2c3d4', nombre: 'Tania', rol: 'miembro', area: 'oficina', jornada: 'media', id_checador: 5, nss: '12345678903',
    })
    expect(result.perfiles[0].foto).toMatch(/\/avatars\/a1b2c3d4-.*\/a\.webp$/)
  })

  test('admin sin persona: todo el equipo, pero el NSS solo el suyo (review PR #126)', async () => {
    const client = createMockSupabase({ responses: { 'profiles.select': profiles([DIEGO, TANIA]) } })
    const result = await listProfiles(asDb(client), U_DIEGO)
    expect(result.total).toBe(2)
    expect(result.perfiles.find((p) => p.nombre === 'Diego')).toMatchObject({ rol: 'administrador', dueno_del_negocio: true, area: 'taller', jornada: null, nss: null, foto: null })
    expect(result.perfiles.find((p) => p.nombre === 'Tania')).not.toHaveProperty('nss')
    expect(JSON.stringify(result)).not.toContain('12345678903')
    expect(result.nota).toMatch(/por nombre/)
  })

  test('admin con persona: resuelve por nombre parcial o por ref y trae su NSS', async () => {
    const client = createMockSupabase({ responses: { 'profiles.select': profiles([DIEGO, TANIA]) } })
    const result = await listProfiles(asDb(client), U_DIEGO, { persona: 'tan' })
    expect(result.perfiles).toMatchObject([{ nombre: 'Tania', nss: '12345678903' }])
    expect(result.nota).toBeUndefined()

    const byRef = await listProfiles(asDb(client), U_DIEGO, { persona: 'a1b2c3d4' })
    expect(byRef.perfiles).toMatchObject([{ nombre: 'Tania', nss: '12345678903' }])
  })

  test('member que pregunta por otro: la RLS no se lo devuelve → error claro', async () => {
    const client = createMockSupabase({ responses: { 'profiles.select': profiles([TANIA]) } })
    await expect(listProfiles(asDb(client), U_TANIA, { persona: 'Diego' })).rejects.toThrow(/Un miembro solo puede consultar lo suyo/)
  })

  test('nunca escribe', async () => {
    const client = createMockSupabase({ responses: { 'profiles.select': profiles([TANIA]) } })
    await listProfiles(asDb(client), U_TANIA)
    expect(client._calls.every((c: CallRecord) => c.op === 'select')).toBe(true)
  })
})
