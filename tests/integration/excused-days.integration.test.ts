/**
 * Excused days and the owner flag against local Supabase (meeting 2026-10-01): only an admin
 * writes, a member reads team-wide days and their own, and nobody crowns themself.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authedClient, authedClientAs } from './helpers/clients'
import { resetDb, sql, closePool, LOCAL } from './helpers/db'

const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1'
const MEMBER_ID = '00000000-0000-0000-0000-0000000000a2'

let admin: SupabaseClient
let member: SupabaseClient

beforeAll(async () => {
  admin = await authedClient()
  member = await authedClientAs(LOCAL.member)
})
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

describe('excused_days', () => {
  test('un member no puede marcar ni borrar días (42501 / 0 filas)', async () => {
    const ins = await member.from('excused_days').insert({ work_date: '2026-09-16', kind: 'holiday' })
    expect(ins.error?.code).toBe('42501')

    await sql(`INSERT INTO public.excused_days (work_date, kind) VALUES ('2026-09-16', 'holiday')`)
    const del = await member.from('excused_days').delete().eq('work_date', '2026-09-16').select()
    expect(del.data).toHaveLength(0)
  })

  test('el member ve los del equipo y los suyos, no los de otra persona; el admin ve todos', async () => {
    await sql(
      `INSERT INTO public.excused_days (work_date, user_id, kind) VALUES
         ('2026-09-16', NULL, 'holiday'), ('2026-09-25', $1, 'early_release'), ('2026-09-26', $2, 'early_release')`,
      [MEMBER_ID, ADMIN_ID],
    )
    const own = await member.from('excused_days').select('work_date').order('work_date')
    expect(own.data).toEqual([{ work_date: '2026-09-16' }, { work_date: '2026-09-25' }])
    const all = await admin.from('excused_days').select('id')
    expect(all.data).toHaveLength(3)
  })

  test('el admin marca un día; el mismo día dos veces para el equipo choca (23505)', async () => {
    const first = await admin.from('excused_days').insert({ work_date: '2026-09-16', kind: 'holiday' }).select('created_by')
    expect(first.data).toEqual([{ created_by: ADMIN_ID }])
    const dup = await admin.from('excused_days').insert({ work_date: '2026-09-16', kind: 'early_release' })
    expect(dup.error?.code).toBe('23505')
  })

  test('el admin cambia un día en su lugar (save_excused_day lo necesita); un member no (0 filas) — review PR #138', async () => {
    await sql(`INSERT INTO public.excused_days (work_date, kind) VALUES ('2026-09-16', 'holiday')`)
    const changed = await admin.from('excused_days').update({ kind: 'early_release', note: 'salida 2 pm' }).eq('work_date', '2026-09-16').select('kind, note')
    expect(changed.error).toBeNull()
    expect(changed.data).toEqual([{ kind: 'early_release', note: 'salida 2 pm' }])

    const denied = await member.from('excused_days').update({ kind: 'holiday' }).eq('work_date', '2026-09-16').select()
    expect(denied.error).toBeNull()
    expect(denied.data).toHaveLength(0)
    expect(await sql(`SELECT kind FROM public.excused_days WHERE work_date = '2026-09-16'`)).toEqual([{ kind: 'early_release' }])
  })
})

describe('profiles.is_owner', () => {
  test('un member no puede coronarse (42501); el admin sí, y solo puede haber un dueño', async () => {
    const self = await member.from('profiles').update({ is_owner: true }).eq('id', MEMBER_ID).select()
    expect(self.error?.code).toBe('42501')

    const crown = await admin.from('profiles').update({ is_owner: true }).eq('id', ADMIN_ID).select('is_owner')
    expect(crown.data).toEqual([{ is_owner: true }])
    const second = await admin.from('profiles').update({ is_owner: true }).eq('id', MEMBER_ID).select()
    expect(second.error?.code).toBe('23505')
  })
})
