/**
 * Mi perfil (#122) against local Supabase: self-edit through RLS, the trigger that keeps the
 * admin fields admin-only, and the per-folder storage policies of the avatars bucket.
 */
import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest } from '../helpers/request'
import { authedClient, authedClientAs, serviceClient } from './helpers/clients'
import { resetDb, sql, closePool, LOCAL } from './helpers/db'
import * as profileRoute from '@/app/api/profile/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1'
const MEMBER_ID = '00000000-0000-0000-0000-0000000000a2'
const VALID_NSS = '12345678903'

let admin: SupabaseClient
let member: SupabaseClient
let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)
const uploaded: string[] = []

beforeAll(async () => {
  admin = await authedClient()
  member = await authedClientAs(LOCAL.member)
})
beforeEach(async () => { await resetDb(); activeClient = member })
afterEach(async () => {
  if (uploaded.length) await serviceClient().storage.from('avatars').remove(uploaded.splice(0))
})
afterAll(async () => { await closePool() })

const profileRow = async (id: string) =>
  (await sql<{ display_name: string; role: string; shift: string | null; clock_employee_id: number | null; nss: string | null; avatar_path: string | null }>(
    'SELECT display_name, role, shift, clock_employee_id, nss, avatar_path FROM public.profiles WHERE id = $1',
    [id],
  ))[0]

const webp = () => new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])], { type: 'image/webp' })

describe('profiles: auto-edición', () => {
  test('un member cambia su nombre, su NSS y su foto', async () => {
    const res = await member
      .from('profiles')
      .update({ display_name: 'Tania Cruz', nss: VALID_NSS, avatar_path: `${MEMBER_ID}/a.webp` })
      .eq('id', MEMBER_ID)
      .select('display_name')
    expect(res.error).toBeNull()
    expect(res.data).toEqual([{ display_name: 'Tania Cruz' }])
    expect(await profileRow(MEMBER_ID)).toMatchObject({ nss: VALID_NSS, avatar_path: `${MEMBER_ID}/a.webp` })
  })

  test.each([
    ['rol', { role: 'admin' }],
    ['jornada', { shift: 'full_time' }],
    ['id del checador', { clock_employee_id: 9 }],
    ['área', { area: 'workshop' }],
  ])('un member no puede cambiar su %s (42501) y la fila no se toca', async (_label, change) => {
    const res = await member.from('profiles').update({ display_name: 'Colado', ...change }).eq('id', MEMBER_ID).select()
    expect(res.error?.code).toBe('42501')
    expect(await profileRow(MEMBER_ID)).toMatchObject({ display_name: 'Member', role: 'member', shift: null, clock_employee_id: 5 })
  })

  test('REGLA: la tarifa por hora no es legible por la persona — vive en profile_pay, solo admin (review PR #137)', async () => {
    // The column is gone from the row the person can read.
    const column = await member.from('profiles').select('hourly_rate').eq('id', MEMBER_ID)
    expect(column.error?.code).toBe('42703')
    // The admin-only table: a member reads nothing and cannot write, even their own row.
    expect((await member.from('profile_pay').select('*')).data).toEqual([])
    expect((await member.from('profile_pay').upsert({ profile_id: MEMBER_ID, hourly_rate: 100 })).error?.code).toBe('42501')
    expect(await sql('SELECT hourly_rate::text FROM public.profile_pay WHERE profile_id = $1', [MEMBER_ID])).toEqual([{ hourly_rate: '52.00' }])
    // The admin sees it embedded and can change it.
    const seen = await admin.from('profiles').select('id, profile_pay(hourly_rate)').eq('id', MEMBER_ID).single()
    expect(seen.data).toMatchObject({ profile_pay: { hourly_rate: '52.00' } })
    expect((await admin.from('profile_pay').upsert({ profile_id: MEMBER_ID, hourly_rate: 60 }, { onConflict: 'profile_id' })).error).toBeNull()
    expect(await sql('SELECT hourly_rate::text FROM public.profile_pay WHERE profile_id = $1', [MEMBER_ID])).toEqual([{ hourly_rate: '60.00' }])
  })

  test('un member no edita el perfil de otro (0 filas) ni lo lee', async () => {
    const upd = await member.from('profiles').update({ nss: VALID_NSS }).eq('id', ADMIN_ID).select()
    expect(upd.error).toBeNull()
    expect(upd.data).toHaveLength(0)
    expect((await profileRow(ADMIN_ID)).nss).toBeNull()

    const read = await member.from('profiles').select('nss').eq('id', ADMIN_ID)
    expect(read.data).toEqual([])
  })

  test('el admin edita nombre, NSS, rol y jornada de otro', async () => {
    const res = await admin
      .from('profiles')
      .update({ display_name: 'Tania', nss: VALID_NSS, shift: 'part_time' })
      .eq('id', MEMBER_ID)
      .select('nss, shift')
    expect(res.data).toEqual([{ nss: VALID_NSS, shift: 'part_time' }])
  })

  test('el CHECK del nombre dice lo mismo que la ruta: 1 a 80 caracteres (review PR #126)', async () => {
    const long = await member.from('profiles').update({ display_name: 'x'.repeat(81) }).eq('id', MEMBER_ID).select()
    expect(long.error?.code).toBe('23514')
    const blank = await member.from('profiles').update({ display_name: '   ' }).eq('id', MEMBER_ID).select()
    expect(blank.error?.code).toBe('23514')
  })

  test('el CHECK rechaza un NSS que no son 11 dígitos y una foto fuera de la carpeta propia', async () => {
    const nss = await member.from('profiles').update({ nss: '1234' }).eq('id', MEMBER_ID).select()
    expect(nss.error?.code).toBe('23514')
    const avatar = await member.from('profiles').update({ avatar_path: `${ADMIN_ID}/a.webp` }).eq('id', MEMBER_ID).select()
    expect(avatar.error?.code).toBe('23514')
  })
})

describe('PATCH /api/profile contra la BD real', () => {
  test('un member guarda su nombre y su NSS normalizado', async () => {
    const res = await profileRoute.PATCH(makeRequest({ display_name: 'Tania Cruz', nss: '1234 5678 903' }, { method: 'PATCH' }))
    expect(res.status).toBe(200)
    expect(await profileRow(MEMBER_ID)).toMatchObject({ display_name: 'Tania Cruz', nss: VALID_NSS, role: 'member' })
  })
})

describe('bucket avatars', () => {
  test('cada quien sube y borra solo en su carpeta', async () => {
    const own = `${MEMBER_ID}/${crypto.randomUUID()}.webp`
    const up = await member.storage.from('avatars').upload(own, webp(), { contentType: 'image/webp' })
    expect(up.error).toBeNull()
    uploaded.push(own)

    const foreign = `${ADMIN_ID}/${crypto.randomUUID()}.webp`
    const denied = await member.storage.from('avatars').upload(foreign, webp(), { contentType: 'image/webp' })
    expect(denied.error).not.toBeNull()

    const adminFile = `${ADMIN_ID}/${crypto.randomUUID()}.webp`
    await admin.storage.from('avatars').upload(adminFile, webp(), { contentType: 'image/webp' })
    uploaded.push(adminFile)
    const removed = await member.storage.from('avatars').remove([adminFile])
    expect(removed.data).toEqual([])
    const [{ count }] = await sql<{ count: string }>(
      `SELECT count(*) FROM storage.objects WHERE bucket_id = 'avatars' AND name = $1`,
      [adminFile],
    )
    expect(Number(count)).toBe(1)

    const mine = await member.storage.from('avatars').remove([own])
    expect(mine.data).toHaveLength(1)
  })

  test('el bucket rechaza un SVG', async () => {
    const path = `${MEMBER_ID}/${crypto.randomUUID()}.svg`
    const res = await member.storage
      .from('avatars')
      .upload(path, new Blob(['<svg/>'], { type: 'image/svg+xml' }), { contentType: 'image/svg+xml' })
    expect(res.error).not.toBeNull()
  })
})
