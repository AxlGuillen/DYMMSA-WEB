/** profiles-store (#155 D): the rules of both profile routes and of save_profile live in one place. */

import { describe, test, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseAdminProfileUpdate, ProfileError, updateOwnProfile, updateProfileAsAdmin } from '@/lib/profiles-store'
import { createMockSupabase, filterValue, hasFilter, type CallRecord } from '../helpers/supabase-mock'

const asDb = (mock: ReturnType<typeof createMockSupabase>) => mock as unknown as SupabaseClient
const VALID_NSS = '12345678903'
const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

async function rejection(promise: Promise<unknown>): Promise<ProfileError> {
  const error = await promise.then(() => null, (e: unknown) => e)
  if (error instanceof ProfileError) return error
  throw new Error(`no rechazó con ProfileError: ${String(error)}`)
}

describe('updateOwnProfile', () => {
  test('solo nombre y NSS; cualquier otra llave es 400 y no toca la BD', async () => {
    const db = createMockSupabase()
    const error = await rejection(updateOwnProfile(asDb(db), ME, { display_name: 'Axl', role: 'admin' }))
    expect(error.status).toBe(400)
    expect(error.message).toMatch(/Solo puedes editar tu nombre y tu NSS/)
    expect(db.callsTo('profiles')).toEqual([])
  })

  test('recorta el nombre, valida el NSS con su dígito verificador y escribe solo la fila propia', async () => {
    const db = createMockSupabase({ responses: { 'profiles.update': { data: { id: ME, display_name: 'Axl G' }, error: null } } })
    await updateOwnProfile(asDb(db), ME, { display_name: '  Axl G ', nss: '1234 5678-903' })
    expect(db.updatePayload('profiles')).toEqual({ display_name: 'Axl G', nss: VALID_NSS })
    expect(filterValue(db.callsTo('profiles', 'update')[0], 'id')).toBe(ME)
    expect((await rejection(updateOwnProfile(asDb(db), ME, { nss: '12345678900' }))).status).toBe(400)
    expect((await rejection(updateOwnProfile(asDb(db), ME, { display_name: '  ' }))).status).toBe(400)
  })

  test('sin cambios es 400; sin fila, 404', async () => {
    expect((await rejection(updateOwnProfile(asDb(createMockSupabase()), ME, {}))).message).toBe('No hay cambios para guardar')
    const missing = createMockSupabase({ responses: { 'profiles.update': { data: null, error: { code: 'PGRST116' } } } })
    expect((await rejection(updateOwnProfile(asDb(missing), ME, { display_name: 'X' }))).status).toBe(404)
  })
})

describe('parseAdminProfileUpdate', () => {
  test('valida cada campo con los mensajes de la ruta', () => {
    const bad = (body: Record<string, unknown>) => {
      try {
        parseAdminProfileUpdate(body)
      } catch (error) {
        return (error as ProfileError).message
      }
      return null
    }
    expect(bad({ role: 'dios' })).toBe('Rol inválido')
    expect(bad({ clock_employee_id: 0 })).toBe('El id del checador debe ser un entero mayor a 0')
    expect(bad({ shift: 'tiempo' })).toBe('Jornada inválida')
    expect(bad({ area: 'bodega' })).toBe('Área inválida: oficina o taller')
    expect(bad({ hourly_rate: -5 })).toBe('La tarifa por hora debe ser un monto mayor a 0')
    expect(bad({})).toBe('No hay cambios para guardar')
  })

  test('null limpia el checador y la jornada; la tarifa viaja aparte', () => {
    expect(parseAdminProfileUpdate({ clock_employee_id: null, shift: null, hourly_rate: 60 })).toEqual({
      updates: { clock_employee_id: null, shift: null },
      rate: { value: 60 },
    })
  })
})

describe('updateProfileAsAdmin', () => {
  const table = (role: string, admins = 2) => (rec: CallRecord) => {
    if (hasFilter(rec, 'role')) return { data: null, error: null, count: admins }
    return { data: { id: OTHER, role, display_name: 'Diego' }, error: null }
  }

  test('REGLA: degradar al último administrador es 400 y no escribe', async () => {
    const db = createMockSupabase({ responses: { 'profiles.select': table('admin', 1) } })
    const error = await rejection(updateProfileAsAdmin(asDb(db), OTHER, { role: 'member' }))
    expect(error.message).toBe('Debe quedar al menos un administrador')
    expect(db.callsTo('profiles', 'update')).toEqual([])
  })

  test('sin tarifa en el cambio no toca profile_pay y por default no lee la tarifa', async () => {
    const db = createMockSupabase({ responses: { 'profiles.select': table('member'), 'profiles.update': { data: null, error: null } } })
    await updateProfileAsAdmin(asDb(db), OTHER, { shift: 'part_time' })
    expect(db.callsTo('profile_pay')).toEqual([])
    const last = db.callsTo('profiles', 'select').at(-1)
    expect(last?.columns).not.toMatch(/profile_pay/)
  })

  test('la ruta pide el embed de la tarifa; null la borra y un valor la guarda', async () => {
    const db = createMockSupabase({ responses: { 'profiles.select': table('member'), 'profiles.update': { data: null, error: null } } })
    await updateProfileAsAdmin(asDb(db), OTHER, { hourly_rate: 60 }, 'id, profile_pay(hourly_rate)')
    expect(db.upsertPayload('profile_pay')).toEqual({ profile_id: OTHER, hourly_rate: 60 })
    expect(db.callsTo('profiles', 'select').at(-1)?.columns).toBe('id, profile_pay(hourly_rate)')
    await updateProfileAsAdmin(asDb(db), OTHER, { hourly_rate: null })
    expect(db.callsTo('profile_pay', 'delete')).toHaveLength(1)
  })

  test('un id de checador repetido (23505) es 400 con mensaje; un perfil inexistente, 404', async () => {
    const clash = createMockSupabase({ responses: { 'profiles.select': table('member'), 'profiles.update': { data: null, error: { code: '23505' } } } })
    expect((await rejection(updateProfileAsAdmin(asDb(clash), OTHER, { clock_employee_id: 5 }))).message).toBe('Ese id de checador ya está asignado a otro usuario')
    const none = createMockSupabase({ responses: { 'profiles.select': { data: null, error: null } } })
    expect((await rejection(updateProfileAsAdmin(asDb(none), OTHER, { area: 'office' }))).status).toBe(404)
  })
})
