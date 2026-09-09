/** /api/time-entries: own-rows enforcement, admin edits with trace, and the NGTeco import (#93). */

import { describe, test, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase, MockSupabaseClient, filterValue, hasFilter, type CallRecord } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams, readJson, makeExcelRequestFromRows } from '../helpers/request'
import { AUTH } from '../helpers/factories'
import { NGTECO_WEEK, NGTECO_PERIOD } from '../helpers/fixtures/ngteco'
import { parseNgtecoReport } from '@/lib/timesheet'
import * as entriesRoute from '@/app/api/time-entries/route'
import * as entryById from '@/app/api/time-entries/[id]/route'
import * as importRoute from '@/app/api/time-entries/import/route'
import * as importsRoute from '@/app/api/time-entries/imports/route'
import type { TimeEntry, TimeImportResult } from '@/types/database'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const DIEGO = '11111111-1111-4111-8111-111111111111'
const TANIA = '22222222-2222-4222-8222-222222222222'

const ME_ADMIN = { id: AUTH.id, role: 'admin', display_name: 'Axl', clock_employee_id: null }
const ME_MEMBER = { id: AUTH.id, role: 'member', display_name: 'Tania', clock_employee_id: 5 }

function withRole(me: typeof ME_ADMIN, mapped: Array<{ id: string; clock_employee_id: number }> = []) {
  return (rec: CallRecord) => {
    if (filterValue(rec, 'id') === me.id) return { data: me, error: null }
    if (hasFilter(rec, 'clock_employee_id', 'not')) return { data: mapped, error: null }
    return { data: [me], error: null }
  }
}

function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'te-1',
    user_id: DIEGO,
    work_date: '2026-08-31',
    source_clock_in: '10:06:00',
    clock_in: '10:06:00',
    clock_out: '18:27:00',
    note: null,
    source: 'import',
    edited_by: null,
    edited_at: null,
    original: null,
    created_at: '2026-09-07T00:00:00Z',
    updated_at: '2026-09-07T00:00:00Z',
    ...overrides,
  }
}

function get(query: string) {
  return entriesRoute.GET(makeRequest(undefined, { url: `http://x/api/time-entries${query}` }))
}

describe('GET /api/time-entries', () => {
  test('un member recibe solo lo propio aunque pida otro usuario', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': withRole(ME_MEMBER), 'time_entries.select': { data: [], error: null } },
    })
    const res = await get(`?user=${DIEGO}&from=2026-08-31&to=2026-09-06`)
    expect(res.status).toBe(200)
    const call = activeClient.callsTo('time_entries', 'select')[0]
    expect(filterValue(call, 'user_id')).toBe(AUTH.id)
    const body = await readJson<{ user: string }>(res)
    expect(body.user).toBe(AUTH.id)
  })

  test('un admin puede consultar a otro usuario', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': withRole(ME_ADMIN), 'time_entries.select': { data: [], error: null } },
    })
    await get(`?user=${DIEGO}&from=2026-08-31&to=2026-09-06`)
    expect(filterValue(activeClient.callsTo('time_entries', 'select')[0], 'user_id')).toBe(DIEGO)
  })

  test('user que no es UUID → 400 (no 500 por 22P02)', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': withRole(ME_ADMIN) } })
    const res = await get('?user=basura')
    expect(res.status).toBe(400)
    expect(activeClient.didCall('time_entries', 'select')).toBe(false)
  })

  test('rango invertido → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': withRole(ME_ADMIN) } })
    expect((await get('?from=2026-09-06&to=2026-08-31')).status).toBe(400)
  })

  test('normaliza HH:MM:SS a HH:MM y arma la semana', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': withRole(ME_MEMBER),
        'time_entries.select': { data: [entry({ user_id: AUTH.id })], error: null },
      },
    })
    const res = await get('?from=2026-08-31&to=2026-09-06')
    const body = await readJson<{ entries: TimeEntry[]; week: { start: string; minutes: number; days: unknown[] } }>(res)
    expect(body.entries[0].clock_in).toBe('10:06')
    expect(body.entries[0].clock_out).toBe('18:27')
    expect(body.entries[0].source_clock_in).toBe('10:06')
    expect(body.week.start).toBe('2026-08-31')
    expect(body.week.days).toHaveLength(7)
    expect(body.week.minutes).toBe(8 * 60 + 21)
  })

  test('rango que no es una semana completa → week: null', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': withRole(ME_MEMBER), 'time_entries.select': { data: [], error: null } },
    })
    const res = await get('?from=2026-09-10&to=2026-09-13')
    expect(res.status).toBe(200)
    expect((await readJson<{ week: unknown }>(res)).week).toBeNull()
  })

  test('sin from/to usa la semana actual', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': withRole(ME_MEMBER), 'time_entries.select': { data: [], error: null } },
    })
    const res = await get('')
    expect(res.status).toBe(200)
    const call = activeClient.callsTo('time_entries', 'select')[0]
    expect(filterValue(call, 'work_date', 'gte')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(filterValue(call, 'work_date', 'lte')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('POST /api/time-entries (captura manual)', () => {
  const body = { user_id: DIEGO, work_date: '2026-09-02', clock_in: '9:05', clock_out: '18:00', note: ' llegó tarde ' }

  test('403 para un member', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': withRole(ME_MEMBER) } })
    expect((await entriesRoute.POST(makeRequest(body))).status).toBe(403)
    expect(activeClient.didCall('time_entries', 'insert')).toBe(false)
  })

  test('nace manual con source_clock_in = clock_in normalizado', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': withRole(ME_ADMIN),
        'time_entries.insert': { data: entry({ source: 'manual' }), error: null },
      },
    })
    const res = await entriesRoute.POST(makeRequest(body))
    expect(res.status).toBe(201)
    expect(activeClient.insertPayload<Record<string, unknown>>('time_entries')).toEqual({
      user_id: DIEGO,
      work_date: '2026-09-02',
      source_clock_in: '09:05',
      clock_in: '09:05',
      clock_out: '18:00',
      note: 'llegó tarde',
      source: 'manual',
    })
  })

  test('salida antes de la entrada → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': withRole(ME_ADMIN) } })
    const res = await entriesRoute.POST(makeRequest({ ...body, clock_out: '08:00' }))
    expect(res.status).toBe(400)
  })

  test('pareja duplicada (23505) → 400', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': withRole(ME_ADMIN),
        'time_entries.insert': { data: null, error: { code: '23505' } },
      },
    })
    expect((await entriesRoute.POST(makeRequest(body))).status).toBe(400)
  })
})

describe('PATCH /api/time-entries/[id] (corrección con rastro)', () => {
  function patch(body: unknown) {
    return entryById.PATCH(makeRequest(body, { method: 'PATCH' }), makeParams({ id: 'te-1' }))
  }

  test('403 para un member', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': withRole(ME_MEMBER) } })
    expect((await patch({ clock_out: '18:30' })).status).toBe(403)
  })

  test('sella edited_by/edited_at y escribe original la primera vez', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': withRole(ME_ADMIN),
        'time_entries.select': { data: entry(), error: null },
        'time_entries.update': { data: entry({ clock_out: '18:30:00' }), error: null },
      },
    })
    const res = await patch({ clock_out: '18:30', source_clock_in: '00:00' })
    expect(res.status).toBe(200)
    const payload = activeClient.updatePayload('time_entries')
    expect(payload.clock_out).toBe('18:30')
    expect(payload.edited_by).toBe(AUTH.id)
    expect(typeof payload.edited_at).toBe('string')
    expect(payload.original).toEqual({ clock_in: '10:06', clock_out: '18:27', note: null })
    expect(payload).not.toHaveProperty('source_clock_in')
    expect((await readJson<TimeEntry>(res)).clock_out).toBe('18:30')
  })

  test('editar solo la nota no sella el rastro (el import aún puede completar la salida)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': withRole(ME_ADMIN),
        'time_entries.select': { data: entry(), error: null },
        'time_entries.update': { data: entry({ note: 'olvidó checar' }), error: null },
      },
    })
    const res = await patch({ note: 'olvidó checar' })
    expect(res.status).toBe(200)
    expect(activeClient.updatePayload('time_entries')).toEqual({ note: 'olvidó checar' })
  })

  test('original no se sobreescribe en una segunda corrección', async () => {
    const original = { clock_in: '10:06', clock_out: '18:27', note: null }
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': withRole(ME_ADMIN),
        'time_entries.select': { data: entry({ clock_out: '18:30:00', edited_at: '2026-09-07T10:00:00Z', original }), error: null },
        'time_entries.update': { data: entry(), error: null },
      },
    })
    await patch({ clock_out: '18:45' })
    expect(activeClient.updatePayload('time_entries')).not.toHaveProperty('original')
  })

  test('salida vacía queda abierta; salida antes de la entrada → 400', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': withRole(ME_ADMIN),
        'time_entries.select': { data: entry(), error: null },
        'time_entries.update': { data: entry({ clock_out: null }), error: null },
      },
    })
    expect((await patch({ clock_out: '' })).status).toBe(200)
    expect(activeClient.updatePayload('time_entries').clock_out).toBeNull()
    expect((await patch({ clock_in: '19:00' })).status).toBe(400)
  })

  test('checada inexistente → 404', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': withRole(ME_ADMIN), 'time_entries.select': { data: null, error: null } },
    })
    expect((await patch({ note: 'x' })).status).toBe(404)
  })

  test('DELETE solo admin', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': withRole(ME_MEMBER) } })
    const denied = await entryById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: 'te-1' }))
    expect(denied.status).toBe(403)

    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': withRole(ME_ADMIN), 'time_entries.delete': { data: [{ id: 'te-1' }], error: null } },
    })
    const ok = await entryById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: 'te-1' }))
    expect(ok.status).toBe(200)
    expect(filterValue(activeClient.callsTo('time_entries', 'delete')[0], 'id')).toBe('te-1')
  })

  test('DELETE de una checada inexistente → 404', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': withRole(ME_ADMIN), 'time_entries.delete': { data: [], error: null } },
    })
    const res = await entryById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: 'nope' }))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/time-entries/import (reporte NGTeco)', () => {
  const RPC_OK = { data: { import_id: 'imp-1', inserted: 3, updated: 1, skipped_edited: 1 }, error: null }

  test('403 para un member, sin leer el archivo', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': withRole(ME_MEMBER) } })
    const res = await importRoute.POST(makeExcelRequestFromRows(NGTECO_WEEK))
    expect(res.status).toBe(403)
    expect(activeClient._rpcCalls).toHaveLength(0)
  })

  test('sin archivo → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': withRole(ME_ADMIN) } })
    const res = await importRoute.POST(makeExcelRequestFromRows(NGTECO_WEEK, { omitFile: true }))
    expect(res.status).toBe(400)
  })

  test('un Excel que no es el reporte → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': withRole(ME_ADMIN) } })
    const res = await importRoute.POST(makeExcelRequestFromRows([['codigo', 'cantidad'], ['A1', '2']], { bookType: 'xlsx' }))
    expect(res.status).toBe(400)
    expect(activeClient._rpcCalls).toHaveLength(0)
  })

  test('.xls real: mapea por id de checador, llama a la RPC y reporta no mapeados', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': withRole(ME_ADMIN, [{ id: DIEGO, clock_employee_id: 1 }]),
        'rpc.import_time_entries': RPC_OK,
      },
    })
    const res = await importRoute.POST(makeExcelRequestFromRows(NGTECO_WEEK, { fileName: 'NGTimereport-20260831.xls' }))
    expect(res.status).toBe(200)
    const body = await readJson<TimeImportResult>(res)
    expect(body.period).toEqual(NGTECO_PERIOD)
    expect(body.inserted).toBe(3)
    expect(body.updated).toBe(1)
    expect(body.skipped_edited).toBe(1)
    expect(body.unmapped).toEqual([{ clockId: 5, name: 'Tania' }])
    expect(Array.isArray(body.warnings)).toBe(true)

    expect(activeClient._rpcCalls).toHaveLength(1)
    const { fn, params } = activeClient._rpcCalls[0]
    expect(fn).toBe('import_time_entries')
    const p = params as { p_entries: Array<{ user_id: string; work_date: string; clock_in: string; clock_out: string | null }>; p_period_start: string; p_period_end: string; p_file_name: string }
    expect(p.p_period_start).toBe(NGTECO_PERIOD.start)
    expect(p.p_period_end).toBe(NGTECO_PERIOD.end)
    expect(p.p_file_name).toBe('NGTimereport-20260831.xls')

    const diego = parseNgtecoReport(NGTECO_WEEK).employees.find((e) => e.clockId === 1)!
    expect(p.p_entries).toHaveLength(diego.punches.length)
    expect(p.p_entries.every((e) => e.user_id === DIEGO)).toBe(true)
    expect(p.p_entries).toContainEqual({ user_id: DIEGO, work_date: '2026-09-01', clock_in: '19:21', clock_out: '19:21' })
    expect(p.p_entries).toContainEqual({ user_id: DIEGO, work_date: '2026-09-03', clock_in: '09:02', clock_out: null })
  })

  test('una pareja con salida antes de la entrada se filtra con aviso y no tumba el import', async () => {
    const rows = NGTECO_WEEK.map((r) => [...r])
    rows[5] = ['LU', '2026-08-31', '10:06', '09:00', '', '', '', '']
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': withRole(ME_ADMIN, [{ id: DIEGO, clock_employee_id: 1 }]),
        'rpc.import_time_entries': RPC_OK,
      },
    })
    const res = await importRoute.POST(makeExcelRequestFromRows(rows))
    expect(res.status).toBe(200)
    const body = await readJson<TimeImportResult>(res)
    expect(body.warnings).toContainEqual(expect.stringMatching(/^Salida antes de la entrada: Diego Baltazar 2026-08-31 10:06–09:00/))
    const p = activeClient._rpcCalls[0].params as { p_entries: Array<{ work_date: string }> }
    expect(p.p_entries.some((e) => e.work_date === '2026-08-31')).toBe(false)
    expect(p.p_entries.length).toBeGreaterThan(0)
  })

  test('la BD rechaza la pareja (23514) → 400 descriptivo', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': withRole(ME_ADMIN, [{ id: DIEGO, clock_employee_id: 1 }]),
        'rpc.import_time_entries': { data: null, error: { code: '23514' } },
      },
    })
    expect((await importRoute.POST(makeExcelRequestFromRows(NGTECO_WEEK))).status).toBe(400)
  })

  test('archivo mayor a 5 MB → 400 antes de parsear el Excel', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': withRole(ME_ADMIN) } })
    const fd = new FormData()
    fd.set('file', new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.xls'))
    const res = await importRoute.POST(new NextRequest('http://x/api/time-entries/import', { method: 'POST', body: fd }))
    expect(res.status).toBe(400)
  })

  test('nadie mapeado: responde sin llamar a la RPC', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': withRole(ME_ADMIN, []), 'rpc.import_time_entries': RPC_OK },
    })
    const res = await importRoute.POST(makeExcelRequestFromRows(NGTECO_WEEK))
    expect(res.status).toBe(200)
    const body = await readJson<TimeImportResult>(res)
    expect(body.inserted).toBe(0)
    expect(body.unmapped.map((u) => u.clockId)).toEqual([1, 5])
    expect(activeClient._rpcCalls).toHaveLength(0)
  })

  test('la RPC rechazada por RLS (42501) → 403', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': withRole(ME_ADMIN, [{ id: DIEGO, clock_employee_id: 1 }, { id: TANIA, clock_employee_id: 5 }]),
        'rpc.import_time_entries': { data: null, error: { code: '42501' } },
      },
    })
    expect((await importRoute.POST(makeExcelRequestFromRows(NGTECO_WEEK))).status).toBe(403)
  })
})

describe('GET /api/time-entries/imports', () => {
  test('lista las cargas, la más reciente primero', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'time_imports.select': { data: [{ id: 'imp-1', period_start: '2026-08-31' }], error: null } },
    })
    const res = await importsRoute.GET()
    expect(res.status).toBe(200)
    expect(await readJson<unknown[]>(res)).toHaveLength(1)
    const call = activeClient.callsTo('time_imports', 'select')[0]
    expect(call.filters.find((f) => f.method === 'order')?.args).toEqual(['created_at', { ascending: false }])
  })
})
