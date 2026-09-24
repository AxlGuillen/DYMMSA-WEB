/** Payables routes (#84): precise 404 before the FK, status→paid stamps paid_at
 *  and →pending clears it, month filter goes by DUE date. */

import { describe, test, expect, vi } from 'vitest'
import {
  createMockSupabase,
  MockSupabaseClient,
  filterValue,
} from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import * as payables from '@/app/api/payables/route'
import * as payableById from '@/app/api/payables/[id]/route'
import * as overview from '@/app/api/payables/overview/route'
import * as payableEvents from '@/app/api/payables/[id]/events/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const PAYABLE_ROW = {
  id: 'p1',
  supplier_id: 's1',
  concept: 'Material eléctrico',
  amount: 1500,
  invoice_date: '2026-09-01',
  due_date: '2026-10-01',
  status: 'pending',
  paid_at: null,
  notes: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  supplier: { id: 's1', name: 'Proveedor X', payment_terms_days: 30 },
}

const ME_ADMIN = { id: AUTH.id, role: 'admin', display_name: 'Axl' }
const ME_MEMBER = { id: AUTH.id, role: 'member', display_name: 'Tania' }
const PAID_EVENT = { entity_id: 'p1', actor_name: 'Diego', created_at: '2026-09-10T18:00:00Z' }

const VALID_BODY = {
  supplier_id: 's1',
  concept: 'Material eléctrico',
  amount: 1500,
  invoice_date: '2026-09-01',
  due_date: '2026-10-01',
}

describe('GET /api/payables', () => {
  test('401 sin usuario', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables' }))).status).toBe(401)
  })

  test('lista paginada con proveedor embebido', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.select': { data: [PAYABLE_ROW], error: null, count: 1 } },
    })
    const res = await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables?page=1' }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data[0].supplier.name).toBe('Proveedor X')
    expect(body).toMatchObject({ count: 1, page: 1, totalPages: 1 })
  })

  test('filtro por mes acota por VENCIMIENTO [inicio, mes siguiente)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.select': { data: [], error: null, count: 0 } },
    })
    await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables?month=2026-12' }))
    const call = activeClient.callsTo('payables', 'select')[0]
    expect(filterValue(call, 'due_date', 'gte')).toBe('2026-12-01')
    expect(filterValue(call, 'due_date', 'lt')).toBe('2027-01-01')
  })

  test('filtra por proveedor (uuid) y por rango de monto', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'payables.select': { data: [], error: null, count: 0 } } })
    const supplier = '11111111-2222-4333-8444-555555555555'
    const res = await payables.GET(makeRequest(undefined, {
      url: `http://x/api/payables?supplier=${supplier}&minAmount=100&maxAmount=2500.5`,
    }))
    expect(res.status).toBe(200)
    const rec = activeClient.callsTo('payables', 'select')[0]
    expect(filterValue(rec, 'supplier_id')).toBe(supplier)
    const by = (m: string) => rec.filters.find((f) => f.method === m)?.args
    expect(by('gte')).toEqual(['amount', 100])
    expect(by('lte')).toEqual(['amount', 2500.5])
  })

  test('proveedor que no es uuid se ignora; monto inválido o mín > máx → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'payables.select': { data: [], error: null, count: 0 } } })
    await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables?supplier=abc' }))
    expect(filterValue(activeClient.callsTo('payables', 'select')[0], 'supplier_id')).toBeUndefined()

    expect((await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables?minAmount=abc' }))).status).toBe(400)
    expect((await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables?minAmount=-1' }))).status).toBe(400)
    expect((await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables?minAmount=500&maxAmount=100' }))).status).toBe(400)
  })

  test('admin: cada fila PAGADA trae paid_by con el último evento; una pendiente con evento viejo va en null', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': { data: ME_ADMIN, error: null },
        'payables.select': { data: [{ ...PAYABLE_ROW, status: 'paid', paid_at: '2026-09-10' }, { ...PAYABLE_ROW, id: 'p2', status: 'paid', paid_at: '2026-09-11' }, { ...PAYABLE_ROW, id: 'p3' }], error: null, count: 3 },
        'audit_events.select': { data: [PAID_EVENT, { ...PAID_EVENT, actor_name: 'Viejo', created_at: '2026-09-01T00:00:00Z' }], error: null },
      },
    })
    const res = await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables' }))
    const body = await readJson<{ data: Array<{ id: string; paid_by: unknown }> }>(res)
    // Newest event wins; a paid payable without one gets an explicit null; a pending one is
    // never looked up (its old "paid" event would mislead) — review PR #106.
    expect(body.data[0].paid_by).toEqual({ name: 'Diego', at: '2026-09-10T18:00:00Z' })
    expect(body.data[1].paid_by).toBeNull()
    expect(body.data[2].paid_by).toBeNull()
    const rec = activeClient.callsTo('audit_events', 'select')[0]
    expect(filterValue(rec, 'entity_type')).toBe('payable')
    expect(filterValue(rec, 'data->to->>status')).toBe('paid')
    expect(rec.filters.find((f) => f.method === 'in')?.args).toEqual(['entity_id', ['p1', 'p2']])
    expect(rec.filters.filter((f) => f.method === 'order').map((f) => f.args[0])).toEqual(['created_at', 'id'])
  })

  test('member: la respuesta NO trae la llave paid_by y nunca consulta la bitácora (ADR-028)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'profiles.select': { data: ME_MEMBER, error: null },
        'payables.select': { data: [PAYABLE_ROW], error: null, count: 1 },
      },
    })
    const res = await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables' }))
    const body = await readJson<{ data: Array<Record<string, unknown>> }>(res)
    expect('paid_by' in body.data[0]).toBe(false)
    expect(activeClient.callsTo('audit_events', 'select')).toHaveLength(0)
  })

  test('sort fuera de whitelist cae a due_date', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.select': { data: [], error: null, count: 0 } },
    })
    await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables?sortField=evil' }))
    const call = activeClient.callsTo('payables', 'select')[0]
    const order = call.filters.find((f) => f.method === 'order')
    expect(order?.args[0]).toBe('due_date')
  })
})

describe('POST /api/payables', () => {
  test('valida proveedor, concepto, monto y fechas', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const cases = [
      { ...VALID_BODY, supplier_id: '' },
      { ...VALID_BODY, concept: '   ' },
      { ...VALID_BODY, amount: 0 },
      { ...VALID_BODY, amount: -5 },
      { ...VALID_BODY, invoice_date: '01/09/2026' },
      { ...VALID_BODY, due_date: 'pronto' },
    ]
    for (const body of cases) {
      expect((await payables.POST(makeRequest(body))).status, JSON.stringify(body)).toBe(400)
    }
  })

  test('404 preciso si el proveedor no existe (antes del FK)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'suppliers.select': { data: null, error: { code: 'PGRST116', message: 'nf' } } },
    })
    const res = await payables.POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(404)
    expect(activeClient.didCall('payables', 'insert')).toBe(false)
  })

  test('crea con status pending y paid_at null', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'suppliers.select': { data: { id: 's1' }, error: null },
        'payables.insert': { data: PAYABLE_ROW, error: null },
      },
    })
    const res = await payables.POST(makeRequest({ ...VALID_BODY, status: 'paid', paid_at: '2026-09-05' }))
    expect(res.status).toBe(201)
    const payload = activeClient.insertPayload('payables')
    // Status is not taken from the client on create: it always starts pending.
    expect(payload).toMatchObject({ status: 'pending', paid_at: null, concept: 'Material eléctrico' })
  })
})

describe('PATCH /api/payables/[id]', () => {
  test('marcar pagada sin paid_at registra la fecha de HOY', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.update': { data: { ...PAYABLE_ROW, status: 'paid' }, error: null } },
    })
    const res = await payableById.PATCH(makeRequest({ status: 'paid' }), makeParams({ id: 'p1' }))
    expect(res.status).toBe(200)
    const updates = activeClient.updatePayload('payables')
    expect(updates.status).toBe('paid')
    expect(updates.paid_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('regresar a pendiente limpia paid_at', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.update': { data: PAYABLE_ROW, error: null } },
    })
    await payableById.PATCH(makeRequest({ status: 'pending' }), makeParams({ id: 'p1' }))
    expect(activeClient.updatePayload('payables')).toMatchObject({ status: 'pending', paid_at: null })
  })

  test('paid con paid_at explícito respeta la fecha real de pago', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.update': { data: PAYABLE_ROW, error: null } },
    })
    await payableById.PATCH(
      makeRequest({ status: 'paid', paid_at: '2026-09-03' }),
      makeParams({ id: 'p1' }),
    )
    expect(activeClient.updatePayload('payables')).toMatchObject({ status: 'paid', paid_at: '2026-09-03' })
  })

  test('404 si la factura no existe; 400 con estado inválido o sin cambios', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.update': { data: null, error: { code: 'PGRST116', message: 'nf' } } },
    })
    expect((await payableById.PATCH(makeRequest({ concept: 'x' }), makeParams({ id: 'nope' }))).status).toBe(404)
    expect((await payableById.PATCH(makeRequest({ status: 'weird' }), makeParams({ id: 'p1' }))).status).toBe(400)
    expect((await payableById.PATCH(makeRequest({}), makeParams({ id: 'p1' }))).status).toBe(400)
  })
})

describe('GET /api/payables/[id]/events', () => {
  test('admin: eventos del payable, más recientes primero', async () => {
    const event = { id: 7, action: 'status_changed', actor_name: 'Diego', data: { to: { status: 'paid' } }, created_at: '2026-09-10T18:00:00Z' }
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': { data: ME_ADMIN, error: null }, 'audit_events.select': { data: [event], error: null } },
    })
    const res = await payableEvents.GET(makeRequest(undefined), makeParams({ id: 'p1' }))
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual([event])
    const rec = activeClient.callsTo('audit_events', 'select')[0]
    expect(filterValue(rec, 'entity_id')).toBe('p1')
    expect(rec.filters.find((f) => f.method === 'order')?.args).toEqual(['created_at', { ascending: false }])
  })

  test('member → 403 sin tocar la bitácora', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'profiles.select': { data: ME_MEMBER, error: null } } })
    const res = await payableEvents.GET(makeRequest(undefined), makeParams({ id: 'p1' }))
    expect(res.status).toBe(403)
    expect(activeClient.callsTo('audit_events', 'select')).toHaveLength(0)
  })
})

describe('GET /api/payables/overview', () => {
  test('ambas lecturas ordenan antes del límite, con id como desempate', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'payables.select': { data: [], error: null } } })
    await overview.GET(makeRequest(undefined, { url: 'http://x/api/payables/overview?month=2026-09' }))

    const [pendingCall, paidCall] = activeClient.callsTo('payables', 'select')
    const orders = (rec: typeof pendingCall) =>
      rec.filters.filter((f) => f.method === 'order').map((f) => f.args[0])
    expect(orders(pendingCall)).toEqual(['due_date', 'id'])
    expect(orders(paidCall)).toEqual(['paid_at', 'id'])
  })

  test('cada lado avisa por separado cuando su lectura llenó el límite', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'payables.select': (rec) =>
          filterValue(rec, 'status') === 'pending'
            ? { data: [], error: null, count: 1500 }
            : { data: [], error: null, count: 12 },
      },
    })
    const res = await overview.GET(makeRequest(undefined, { url: 'http://x/api/payables/overview?month=2026-09' }))
    expect(res.status).toBe(200)
    const body = await readJson<{ pendingTruncated: boolean; paidTruncated: boolean }>(res)
    expect(body.pendingTruncated).toBe(true)
    expect(body.paidTruncated).toBe(false)
  })

  test('exactamente 1000 pendientes NO se marcan truncadas: sí se leyeron todas', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.select': { data: [], error: null, count: 1000 } },
    })
    const res = await overview.GET(makeRequest(undefined, { url: 'http://x/api/payables/overview?month=2026-09' }))
    const body = await readJson<{ pendingTruncated: boolean }>(res)
    expect(body.pendingTruncated).toBe(false)
  })

  test('400 con mes inválido; 200 con resumen calculado', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.select': { data: [PAYABLE_ROW], error: null } },
    })
    expect((await overview.GET(makeRequest(undefined, { url: 'http://x/api/payables/overview?month=13-2026' }))).status).toBe(400)

    const res = await overview.GET(makeRequest(undefined, { url: 'http://x/api/payables/overview?month=2026-10' }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.month).toBe('2026-10')
    // The mock answers both selects with the same fixture, so the row counts twice.
    expect(body.summary.pendingTotal).toBe(3000)
    expect(Array.isArray(body.payables)).toBe(true)
  })

  test('un mes de 30 dias filtra por frontera exclusiva (no por el dia 31)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.select': { data: [PAYABLE_ROW], error: null } },
    })
    const res = await overview.GET(makeRequest(undefined, { url: 'http://x/api/payables/overview?month=2026-09' }))
    expect(res.status).toBe(200)

    // The paid select is the second one: '2026-09-31' does not exist and the old
    // `lte` got a 22008 from Postgres.
    const paidCall = activeClient.callsTo('payables', 'select')[1]
    expect(filterValue(paidCall, 'paid_at', 'gte')).toBe('2026-09-01')
    expect(filterValue(paidCall, 'paid_at', 'lt')).toBe('2026-10-01')
  })
})
