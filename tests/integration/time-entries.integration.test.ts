/**
 * Per-user RLS against local Supabase (ADR-021/ADR-026): the first policies that use
 * auth.uid(). Tested straight on the client — the handler's 403 never reaches the policy —
 * plus the transactional import RPC and the route handlers with real auth.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams, readJson, makeExcelRequestFromRows } from '../helpers/request'
import { NGTECO_WEEK } from '../helpers/fixtures/ngteco'
import { authedClient, authedClientAs } from './helpers/clients'
import { resetDb, sql, closePool, LOCAL } from './helpers/db'
import * as entriesRoute from '@/app/api/time-entries/route'
import * as entryById from '@/app/api/time-entries/[id]/route'
import * as importRoute from '@/app/api/time-entries/import/route'
import * as profilesRoute from '@/app/api/profiles/route'
import type { TimeEntry, TimeImportResult } from '@/types/database'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1'
const MEMBER_ID = '00000000-0000-0000-0000-0000000000a2'

let admin: SupabaseClient
let member: SupabaseClient
let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

beforeAll(async () => {
  admin = await authedClient()
  member = await authedClientAs(LOCAL.member)
})
beforeEach(async () => { await resetDb(); activeClient = admin })
afterAll(async () => { await closePool() })

/** Two pairs for each seeded user, written with the service role (bypasses RLS). */
async function seedEntries() {
  await sql(`
    INSERT INTO public.time_entries (user_id, work_date, source_clock_in, clock_in, clock_out) VALUES
      ($1, '2026-08-31', '10:06', '10:06', '18:27'),
      ($1, '2026-09-01', '09:00', '09:00', NULL),
      ($2, '2026-08-31', '10:06', '10:06', '18:11'),
      ($2, '2026-09-01', '10:05', '10:05', '18:47')
  `, [ADMIN_ID, MEMBER_ID])
}

describe('RLS por usuario (directo al cliente)', () => {
  test('is_admin() responde según el perfil y no recursa', async () => {
    expect((await admin.rpc('is_admin')).data).toBe(true)
    expect((await member.rpc('is_admin')).data).toBe(false)
  })

  test('member: SELECT solo devuelve sus filas; admin ve todas', async () => {
    await seedEntries()
    const mine = await member.from('time_entries').select('user_id')
    expect(mine.error).toBeNull()
    expect(mine.data).toHaveLength(2)
    expect(mine.data!.every((r) => r.user_id === MEMBER_ID)).toBe(true)

    const all = await admin.from('time_entries').select('user_id')
    expect(all.data).toHaveLength(4)
  })

  test('member: INSERT/UPDATE/DELETE rechazados por la policy (42501 / 0 filas)', async () => {
    await seedEntries()
    const ins = await member.from('time_entries').insert({
      user_id: MEMBER_ID, work_date: '2026-09-02', source_clock_in: '09:00', clock_in: '09:00', clock_out: '17:00',
    })
    expect(ins.error?.code).toBe('42501')

    // UPDATE/DELETE under RLS are silent: the rows are simply not visible for writing.
    const upd = await member.from('time_entries').update({ clock_out: '23:00' }).eq('user_id', MEMBER_ID).select()
    expect(upd.error).toBeNull()
    expect(upd.data).toHaveLength(0)
    const del = await member.from('time_entries').delete().eq('user_id', MEMBER_ID).select()
    expect(del.data).toHaveLength(0)
    const [{ count }] = await sql<{ count: string }>('SELECT count(*) FROM public.time_entries')
    expect(Number(count)).toBe(4)
  })

  test('profiles: todos leen la lista; solo admin actualiza', async () => {
    const list = await member.from('profiles').select('id')
    expect(list.data).toHaveLength(2)

    const denied = await member.from('profiles').update({ role: 'admin' }).eq('id', MEMBER_ID).select()
    expect(denied.data).toHaveLength(0)
    const [row] = await sql<{ role: string }>('SELECT role FROM public.profiles WHERE id = $1', [MEMBER_ID])
    expect(row.role).toBe('member')

    const ok = await admin.from('profiles').update({ display_name: 'Tania C.' }).eq('id', MEMBER_ID).select('display_name')
    expect(ok.data?.[0]?.display_name).toBe('Tania C.')
  })

  test('member no puede ejecutar la RPC de import (INVOKER + policy → 42501)', async () => {
    const res = await member.rpc('import_time_entries', {
      p_entries: [{ user_id: MEMBER_ID, work_date: '2026-08-31', clock_in: '10:06', clock_out: '18:11' }],
      p_period_start: '2026-08-31',
      p_period_end: '2026-09-06',
      p_file_name: 'x.xls',
    })
    expect(res.error?.code).toBe('42501')
  })
})

describe('RPC import_time_entries (transaccional, respeta ediciones)', () => {
  const entries = [
    { user_id: MEMBER_ID, work_date: '2026-08-31', clock_in: '10:06', clock_out: '18:11' },
    { user_id: MEMBER_ID, work_date: '2026-09-01', clock_in: '10:05', clock_out: '' },
  ]
  const call = (p_entries: unknown) => admin.rpc('import_time_entries', {
    p_entries, p_period_start: '2026-08-31', p_period_end: '2026-09-06', p_file_name: 'NGTimereport.xls',
  })

  test('primera carga inserta; la segunda actualiza sin duplicar y bitacoriza ambas', async () => {
    const first = await call(entries)
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({ inserted: 2, updated: 0, skipped_edited: 0 })

    const second = await call(entries.map((e) => ({ ...e, clock_out: e.clock_out || '18:00' })))
    expect(second.data).toMatchObject({ inserted: 0, updated: 2, skipped_edited: 0 })

    const rows = await sql<{ clock_out: string | null }>(
      'SELECT clock_out FROM public.time_entries WHERE user_id = $1 ORDER BY work_date', [MEMBER_ID],
    )
    expect(rows).toEqual([{ clock_out: '18:11:00' }, { clock_out: '18:00:00' }])
    const [{ count }] = await sql<{ count: string }>('SELECT count(*) FROM public.time_imports')
    expect(Number(count)).toBe(2)
  })

  test('pareja repetida en el reporte: sobrevive la que trae salida, en cualquier orden', async () => {
    const dup = [
      { user_id: MEMBER_ID, work_date: '2026-09-02', clock_in: '09:00', clock_out: '' },
      { user_id: MEMBER_ID, work_date: '2026-09-02', clock_in: '09:00', clock_out: '17:00' },
    ]
    const res = await call(dup)
    expect(res.data).toMatchObject({ inserted: 1, updated: 0, skipped_edited: 0 })
    const [row] = await sql<{ clock_out: string | null }>(
      "SELECT clock_out FROM public.time_entries WHERE user_id = $1 AND work_date = '2026-09-02'", [MEMBER_ID],
    )
    expect(row.clock_out).toBe('17:00:00')
    expect((await call([...dup].reverse())).data).toMatchObject({ inserted: 0, updated: 1 })
  })

  test('una fila editada por un admin sobrevive al re-import y se reporta como saltada', async () => {
    await call(entries)
    await sql(
      `UPDATE public.time_entries SET clock_out = '19:30', edited_by = $1, edited_at = now()
       WHERE user_id = $2 AND work_date = '2026-08-31'`,
      [ADMIN_ID, MEMBER_ID],
    )
    const again = await call(entries)
    expect(again.data).toMatchObject({ inserted: 0, updated: 1, skipped_edited: 1 })
    const [row] = await sql<{ clock_out: string }>(
      "SELECT clock_out FROM public.time_entries WHERE user_id = $1 AND work_date = '2026-08-31'", [MEMBER_ID],
    )
    expect(row.clock_out).toBe('19:30:00')
  })
})

describe('Route handlers con auth real', () => {
  test('member: GET /api/time-entries ignora ?user= y devuelve lo propio', async () => {
    await seedEntries()
    activeClient = member
    const res = await entriesRoute.GET(
      makeRequest(undefined, { url: `http://x/api/time-entries?user=${ADMIN_ID}&from=2026-08-31&to=2026-09-06` }),
    )
    expect(res.status).toBe(200)
    const body = await readJson<{ user: string; entries: TimeEntry[]; week: { minutes: number } }>(res)
    expect(body.user).toBe(MEMBER_ID)
    expect(body.entries).toHaveLength(2)
    expect(body.entries[0].clock_in).toBe('10:06')
    expect(body.week.minutes).toBe(8 * 60 + 5 + 8 * 60 + 42)
  })

  test('member: PATCH y GET /api/profiles → 403', async () => {
    await seedEntries()
    activeClient = member
    const [row] = await sql<{ id: string }>('SELECT id FROM public.time_entries WHERE user_id = $1 LIMIT 1', [MEMBER_ID])
    const patch = await entryById.PATCH(makeRequest({ clock_out: '20:00' }, { method: 'PATCH' }), makeParams({ id: row.id }))
    expect(patch.status).toBe(403)
    expect((await profilesRoute.GET()).status).toBe(403)
  })

  test('admin: PATCH sella el rastro y conserva original; source_clock_in intacto', async () => {
    await seedEntries()
    const [row] = await sql<{ id: string }>(
      "SELECT id FROM public.time_entries WHERE user_id = $1 AND work_date = '2026-08-31'", [MEMBER_ID],
    )
    const res = await entryById.PATCH(makeRequest({ clock_in: '10:00', clock_out: '18:30' }, { method: 'PATCH' }), makeParams({ id: row.id }))
    expect(res.status).toBe(200)
    const body = await readJson<TimeEntry>(res)
    expect(body.edited_by).toBe(ADMIN_ID)
    expect(body.original).toEqual({ clock_in: '10:06', clock_out: '18:11', note: null })
    expect(body.source_clock_in).toBe('10:06')
    expect(body.clock_in).toBe('10:00')
  })

  test('admin: import del .xls real mapea por clock id (member=5) y reporta al 1 como no mapeado', async () => {
    const res = await importRoute.POST(makeExcelRequestFromRows(NGTECO_WEEK))
    expect(res.status).toBe(200)
    const body = await readJson<TimeImportResult>(res)
    expect(body.unmapped).toEqual([{ clockId: 1, name: 'Diego Baltazar' }])
    expect(body.inserted).toBe(2)
    const rows = await sql<{ user_id: string }>('SELECT user_id FROM public.time_entries')
    expect(rows.every((r) => r.user_id === MEMBER_ID)).toBe(true)
  })
})
