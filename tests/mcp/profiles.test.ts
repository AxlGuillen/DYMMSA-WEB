/** MCP get_profiles (#122): read-only, NSS included; RLS decides who sees whom — the mock plays the policy. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue, type CallRecord } from '../helpers/supabase-mock'
import type { Db } from '@/lib/mcp/shared'
import { getProfiles } from '@/lib/mcp/tools/profiles'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

const TANIA = { id: 'u-tania', display_name: 'Tania', role: 'member', clock_employee_id: 5, shift: 'part_time', nss: '12345678903', avatar_path: 'u-tania/a.webp' }
const DIEGO = { id: 'u-diego', display_name: 'Diego', role: 'admin', clock_employee_id: 1, shift: null, nss: null, avatar_path: null }

function profiles(visible: (typeof TANIA | typeof DIEGO)[]) {
  return (rec: CallRecord) => {
    const id = filterValue(rec, 'id')
    if (id) {
      const row = visible.find((p) => p.id === id) ?? null
      return { data: row, error: row ? null : { code: 'PGRST116' } }
    }
    const like = rec.filters.find((f) => f.method === 'ilike')?.args[1] as string | undefined
    const needle = like?.replace(/%/g, '').toLowerCase() ?? ''
    return { data: visible.filter((p) => p.display_name.toLowerCase().includes(needle)), error: null }
  }
}

describe('get_profiles', () => {
  test('member sin persona: solo su perfil, con NSS, rol y jornada legibles', async () => {
    const client = createMockSupabase({ responses: { 'profiles.select': profiles([TANIA]) } })
    const result = await getProfiles(asDb(client), 'u-tania')
    expect(result.total).toBe(1)
    expect(result.perfiles[0]).toMatchObject({
      nombre: 'Tania', rol: 'Miembro', jornada: 'Medio tiempo · 4 h', id_checador: 5, nss: '12345678903',
    })
    expect(result.perfiles[0].foto).toMatch(/\/avatars\/u-tania\/a\.webp$/)
  })

  test('admin sin persona: todo el equipo, pero el NSS solo el suyo (review PR #126)', async () => {
    const client = createMockSupabase({ responses: { 'profiles.select': profiles([DIEGO, TANIA]) } })
    const result = await getProfiles(asDb(client), 'u-diego')
    expect(result.total).toBe(2)
    expect(result.perfiles.find((p) => p.nombre === 'Diego')).toMatchObject({ rol: 'Administrador', jornada: null, nss: null, foto: null })
    expect(result.perfiles.find((p) => p.nombre === 'Tania')).not.toHaveProperty('nss')
    expect(JSON.stringify(result)).not.toContain('12345678903')
    expect(result.nota).toMatch(/por nombre/)
  })

  test('admin con persona: resuelve por nombre parcial y trae su NSS', async () => {
    const client = createMockSupabase({ responses: { 'profiles.select': profiles([DIEGO, TANIA]) } })
    const result = await getProfiles(asDb(client), 'u-diego', { persona: 'tan' })
    expect(result.perfiles).toMatchObject([{ nombre: 'Tania', nss: '12345678903' }])
    expect(result.nota).toBeNull()
  })

  test('member que pregunta por otro: la RLS no se lo devuelve → error claro', async () => {
    const client = createMockSupabase({ responses: { 'profiles.select': profiles([TANIA]) } })
    await expect(getProfiles(asDb(client), 'u-tania', { persona: 'Diego' })).rejects.toThrow(/Un miembro solo puede consultar lo suyo/)
  })

  test('nunca escribe', async () => {
    const client = createMockSupabase({ responses: { 'profiles.select': profiles([TANIA]) } })
    await getProfiles(asDb(client), 'u-tania')
    expect(client._calls.every((c: CallRecord) => c.op === 'select')).toBe(true)
  })
})
