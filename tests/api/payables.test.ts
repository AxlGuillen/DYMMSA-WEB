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
import { todayInMexico } from '@/lib/format'

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

  test('estado "overdue": pendientes con vencimiento antes de hoy; un estado desconocido no filtra', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'payables.select': { data: [], error: null, count: 0 } } })
    await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables?status=overdue' }))
    const rec = activeClient.callsTo('payables', 'select')[0]
    expect(filterValue(rec, 'status')).toBe('pending')
    expect(filterValue(rec, 'due_date', 'lt')).toBe(todayInMexico())

    // Each GET reads twice (page + footer totals) with the same filters.
    const totalsRec = activeClient.callsTo('payables', 'select')[1]
    expect(filterValue(totalsRec, 'status')).toBe('pending')
    expect(filterValue(totalsRec, 'due_date', 'lt')).toBe(todayInMexico())

    await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables?status=paid' }))
    const paid = activeClient.callsTo('payables', 'select')[2]
    expect(filterValue(paid, 'status')).toBe('paid')
    expect(filterValue(paid, 'due_date', 'lt')).toBeUndefined()

    await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables?status=raro' }))
    expect(filterValue(activeClient.callsTo('payables', 'select')[4], 'status')).toBeUndefined()
  })

  test('el total de abajo suma TODO lo filtrado, por moneda y sin convertir', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'payables.select': {
          data: [PAYABLE_ROW, { ...PAYABLE_ROW, id: 'p2', amount: 250.25 }, { ...PAYABLE_ROW, id: 'p3', amount: 100, currency: 'USD' }],
          error: null,
          count: 3,
        },
      },
    })
    const res = await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables?status=pending&pageSize=1' }))
    const body = await readJson(res)
    expect(body.totals).toEqual({ count: 3, byCurrency: { MXN: 1750.25, USD: 100 }, truncated: false })
    // The totals read has no page range: it covers every filtered row.
    const totalsRec = activeClient.callsTo('payables', 'select')[1]
    expect(filterValue(totalsRec, 'status')).toBe('pending')
    expect(totalsRec.filters.some((f) => f.method === 'range')).toBe(false)
    expect(activeClient.callsTo('payables', 'select')[0].filters.some((f) => f.method === 'range')).toBe(true)
  })

  test('si llegan menos filas que el conteo (max_rows de PostgREST), el total sale marcado incompleto', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.select': { data: [PAYABLE_ROW], error: null, count: 1500 } },
    })
    const body = await readJson(await payables.GET(makeRequest(undefined, { url: 'http://x/api/payables' })))
    expect(body.totals).toMatchObject({ count: 1, truncated: true })
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
      // A day that does not exist: Postgres would answer 22008 → a 500 (review PR #128).
      { ...VALID_BODY, invoice_date: '2026-02-30' },
      { ...VALID_BODY, due_date: '2026-04-31' },
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
    expect(payload).toMatchObject({ status: 'pending', paid_at: null, concept: 'Material eléctrico', currency: 'MXN' })
  })

  test('moneda USD se guarda; una moneda desconocida es 400 sin insertar', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'suppliers.select': { data: { id: 's1' }, error: null },
        'payables.insert': { data: { ...PAYABLE_ROW, currency: 'USD' }, error: null },
      },
    })
    expect((await payables.POST(makeRequest({ ...VALID_BODY, currency: 'USD' }))).status).toBe(201)
    expect(activeClient.insertPayload('payables')).toMatchObject({ currency: 'USD' })

    activeClient = createMockSupabase({ user: AUTH, responses: { 'suppliers.select': { data: { id: 's1' }, error: null } } })
    const bad = await payables.POST(makeRequest({ ...VALID_BODY, currency: 'EUR' }))
    expect(bad.status).toBe(400)
    expect(activeClient.callsTo('payables', 'insert')).toHaveLength(0)
  })
})

describe('PATCH /api/payables/[id]', () => {
  const ID = '9a9a9a9a-0000-4000-8000-000000000001'
  /** The route reads the row's status first (#157); `status` is what it finds. */
  const withRow = (status: string | null, update: unknown = { data: { ...PAYABLE_ROW, id: ID }, error: null }) =>
    createMockSupabase({
      user: AUTH,
      responses: {
        'payables.select': { data: status ? { id: ID, status } : null, error: null },
        'payables.update': update as never,
      },
    })
  const patch = (body: unknown, id = ID) => payableById.PATCH(makeRequest(body), makeParams({ id }))

  test('marcar pagada sin paid_at registra la fecha de HOY', async () => {
    activeClient = withRow('pending', { data: { ...PAYABLE_ROW, status: 'paid' }, error: null })
    const res = await patch({ status: 'paid' })
    expect(res.status).toBe(200)
    const updates = activeClient.updatePayload('payables')
    expect(updates.status).toBe('paid')
    expect(updates.paid_at).toBe(todayInMexico())
  })

  test('regresar a pendiente limpia paid_at', async () => {
    activeClient = withRow('paid')
    await patch({ status: 'pending', paid_at: null })
    expect(activeClient.updatePayload('payables')).toMatchObject({ status: 'pending', paid_at: null })
  })

  test('paid con paid_at explícito respeta la fecha real de pago', async () => {
    activeClient = withRow('pending')
    await patch({ status: 'paid', paid_at: '2026-09-03' })
    expect(activeClient.updatePayload('payables')).toMatchObject({ status: 'paid', paid_at: '2026-09-03' })
  })

  test('#157: paid_at sin status sobre una pendiente o cancelada → 400 sin escribir', async () => {
    for (const status of ['pending', 'cancelled']) {
      activeClient = withRow(status)
      const res = await patch({ paid_at: '2026-09-10' })
      expect(res.status, status).toBe(400)
      expect((await readJson<{ message: string }>(res)).message).toMatch(/Solo una factura pagada lleva fecha de pago/)
      expect(activeClient.callsTo('payables', 'update'), status).toEqual([])
    }
  })

  test('#157: un estado no pagado con fecha de pago → 400; una pagada no se queda sin fecha', async () => {
    activeClient = withRow('paid')
    expect((await patch({ status: 'pending', paid_at: '2026-09-10' })).status).toBe(400)
    expect((await patch({ paid_at: null })).status).toBe(400)
    expect(activeClient.callsTo('payables', 'update')).toEqual([])
  })

  test('#157: corregir solo la fecha de una pagada escribe con guarda de status = paid', async () => {
    activeClient = withRow('paid')
    expect((await patch({ paid_at: '2026-09-12' })).status).toBe(200)
    const update = activeClient.callsTo('payables', 'update')[0]
    expect(update.payload).toEqual({ paid_at: '2026-09-12' })
    expect(filterValue(update, 'status')).toBe('paid')

    // Changed to pending between the read and the write: no row matches → 409, nothing stamped.
    activeClient = withRow('paid', { data: null, error: null })
    const raced = await patch({ paid_at: '2026-09-12' })
    expect(raced.status).toBe(409)
  })

  test('otros cambios no llevan la guarda de status', async () => {
    activeClient = withRow('pending')
    expect((await patch({ amount: 1800, currency: 'USD' })).status).toBe(200)
    const update = activeClient.callsTo('payables', 'update')[0]
    expect(update.payload).toEqual({ amount: 1800, currency: 'USD' })
    expect(filterValue(update, 'status')).toBeUndefined()
  })

  test('404 si la factura no existe o el id no es uuid; 400 con estado inválido o sin cambios', async () => {
    activeClient = withRow(null)
    expect((await patch({ concept: 'x' })).status).toBe(404)
    expect(activeClient.callsTo('payables', 'update')).toEqual([])

    activeClient = withRow('pending')
    expect((await patch({ concept: 'x' }, 'nope')).status).toBe(404)
    expect((await patch({ status: 'weird' })).status).toBe(400)
    expect((await patch({})).status).toBe(400)
    expect((await patch({ due_date: '2026-02-30' })).status).toBe(400)
    expect(activeClient.callsTo('payables', 'update')).toEqual([])
  })

  test('proveedor inexistente → 404 antes del update', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.select': { data: { id: ID, status: 'pending' }, error: null }, 'suppliers.select': { data: null, error: null } },
    })
    const res = await patch({ supplier_id: '9a9a9a9a-0000-4000-8000-0000000000ff' })
    expect(res.status).toBe(404)
    expect((await readJson<{ message: string }>(res)).message).toBe('El proveedor no existe')
    expect(activeClient.callsTo('payables', 'update')).toEqual([])
  })
})

describe('DELETE /api/payables/[id]', () => {
  const ID = '9a9a9a9a-0000-4000-8000-000000000001'
  const del = (id = ID) => payableById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id }))

  test('borra por id', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'payables.delete': { data: [{ id: ID }], error: null } } })
    expect((await del()).status).toBe(200)
    expect(filterValue(activeClient.callsTo('payables', 'delete')[0], 'id')).toBe(ID)
  })

  test('#157: una factura que no existe → 404, no ok; un id que no es uuid → 404 sin consultar', async () => {
    activeClient = createMockSupabase({ user: AUTH, responses: { 'payables.delete': { data: [], error: null } } })
    const res = await del()
    expect(res.status).toBe(404)
    expect((await readJson<{ message: string }>(res)).message).toBe('La factura no existe')

    activeClient = createMockSupabase({ user: AUTH })
    expect((await del('p1')).status).toBe(404)
    expect(activeClient.callsTo('payables')).toEqual([])
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

  test('los dólares no entran al resumen en pesos: van aparte en foreign.USD', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'payables.select': { data: [PAYABLE_ROW, { ...PAYABLE_ROW, id: 'p9', amount: 40, currency: 'USD' }], error: null } },
    })
    const body = await readJson(await overview.GET(makeRequest(undefined, { url: 'http://x/api/payables/overview?month=2026-10' })))
    // The mock answers both selects with the same rows, so each counts twice.
    expect(body.summary.pendingTotal).toBe(3000)
    expect(body.foreign.USD.pendingTotal).toBe(80)
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
