/** /api/clients (#145): auth, range validation, Odoo degradation to 200/null, detail by partner id, cache purge. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { revalidateTag } from 'next/cache'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, readJson } from '../helpers/request'
import { AUTH } from '../helpers/factories'
import { callOdoo, OdooError } from '@/lib/odoo/client'
import type { CustomerDetailResponse, CustomersResponse } from '@/lib/customers'
import * as listRoute from '@/app/api/clients/route'
import * as detailRoute from '@/app/api/clients/[id]/route'
import * as refreshRoute from '@/app/api/clients/refresh/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/odoo/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/odoo/client')>()
  return { ...orig, callOdoo: vi.fn() }
})
// unstable_cache needs a Next request scope; outside it the wrapped fn is enough.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const ANDRITZ = { id: 24, name: 'Andritz', city: 'Morelia', phone: '443 000 0000', email: 'pagos@andritz.test', vat: 'AND010101AAA', days_sales_outstanding: 41.6 }
const BOSCH = { id: 7, name: 'Bosch', city: false, phone: false, email: false, vat: false, days_sales_outstanding: 0 }
// Far past / far future so the run date never flips a status.
const MOVE = (o: Record<string, unknown>) => ({
  id: 1, name: 'F1', move_type: 'out_invoice', partner_id: [24, 'Andritz'], invoice_date: '2020-01-01', invoice_date_due: '2020-02-01',
  amount_total: 100, amount_residual: 100, payment_state: 'not_paid', currency_id: [33, 'MXN'], ...o,
})
const MOVES = [
  MOVE({ id: 1, name: 'F-VIEJA', amount_residual: 100 }),
  MOVE({ id: 2, name: 'F-FUTURA', invoice_date_due: '2099-03-01', amount_residual: 40 }),
  MOVE({ id: 3, name: 'RINV1', move_type: 'out_refund', amount_residual: 30 }),
  // Invoiced but outside the customer list: still gets a row (money is never hidden).
  MOVE({ id: 4, name: 'X-1', partner_id: [55, 'FieldCore'], amount_residual: 500 }),
]
// 01:30 UTC on Oct 3 is 19:30 on Oct 2 in Morelia: the sale belongs to the 2nd.
const SALE = { id: 9, name: 'S00041', date_order: '2026-10-03 01:30:00', amount_total: 1160, state: 'sale', invoice_status: 'to invoice' }
const PAYMENT = { id: 71, name: 'PAY00068', date: '2026-10-01', amount: 580, memo: 'F00387', currency_id: [33, 'MXN'] }

function scriptOdoo() {
  vi.mocked(callOdoo).mockImplementation(async (model) => {
    if (model === 'res.partner') return [ANDRITZ, BOSCH]
    if (model === 'account.move') return MOVES
    if (model === 'sale.order') return [SALE]
    if (model === 'account.payment') return [PAYMENT]
    throw new Error(`modelo inesperado ${model}`)
  })
}

const list = (query = '') => listRoute.GET(makeRequest(undefined, { url: `http://x/api/clients${query}` }))
const detail = (id: string, query = '') =>
  detailRoute.GET(makeRequest(undefined, { url: `http://x/api/clients/${id}${query}` }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  activeClient = createMockSupabase({ user: AUTH })
  vi.mocked(callOdoo).mockReset()
  vi.mocked(revalidateTag).mockClear()
  vi.stubEnv('ODOO_URL', 'https://dymmsa.odoo.com')
  vi.stubEnv('ODOO_API_KEY', 'test-key')
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/clients', () => {
  test('sin usuario → 401', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await list()).status).toBe(401)
  })

  test('rango inválido → 400 con el mensaje', async () => {
    const res = await list('?from=2026-11-01&to=2026-10-01')
    expect(res.status).toBe(400)
    expect(await readJson<{ message: string }>(res)).toMatchObject({ message: expect.stringMatching(/posterior/) })
    expect((await list('?to=2026-02-30')).status).toBe(400)
  })

  test('Odoo sin configurar → 200 con customers null y sin tocar Odoo', async () => {
    vi.stubEnv('ODOO_URL', '')
    const body = await readJson<CustomersResponse>(await list())
    expect(body).toMatchObject({ customers: null, totals: null, reason: 'not_configured' })
    expect(callOdoo).not.toHaveBeenCalled()
  })

  test('Odoo falla → 200 degradado (nunca 500); otro error → 500', async () => {
    vi.mocked(callOdoo).mockRejectedValue(new OdooError('Odoo respondió 503', 503))
    const res = await list()
    expect(res.status).toBe(200)
    expect(await readJson<CustomersResponse>(res)).toMatchObject({ customers: null, reason: 'odoo_error' })

    vi.mocked(callOdoo).mockRejectedValue(new Error('boom'))
    expect((await list()).status).toBe(500)
  })

  test('camino feliz: una fila por cliente, mayor deuda primero, nota de crédito aparte y el rango de la URL', async () => {
    scriptOdoo()
    const res = await list('?from=&to=&filter=all')
    expect(res.status).toBe(200)
    const body = await readJson<CustomersResponse>(res)
    expect(body.range).toEqual({ from: null, to: null, filter: 'all' })
    expect(body.customers?.map((c) => [c.name, c.total, c.creditNotes])).toEqual([
      ['FieldCore', 500, 0],
      ['Andritz', 140, 30],
      ['Bosch', 0, 0],
    ])
    expect(body.customers?.[1]).toMatchObject({ city: 'Morelia', overdue: 100, upcoming: 40, openInvoices: 2, daysToPay: 42 })
    // Gross: the 30 of credit is NOT subtracted (#102).
    expect(body.totals).toEqual({ overdue: 600, upcoming: 40, total: 640, openInvoices: 3, creditNotes: 30, currencies: [] })
    expect(body.truncated).toBe(false)
    expect(typeof body.fetchedAt).toBe('string')
  })

  test('sin parámetros aplica el default: lo vencido y lo que vence este mes (no lo de 2099)', async () => {
    scriptOdoo()
    const body = await readJson<CustomersResponse>(await list())
    expect(body.range.from).toBeNull()
    expect(body.customers?.find((c) => c.name === 'Andritz')).toMatchObject({ overdue: 100, upcoming: 0, total: 100 })
  })
})

describe('GET /api/clients/[id]', () => {
  test('sin usuario → 401; id que no es número → 404 sin tocar Odoo', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await detail('24')).status).toBe(401)
    activeClient = createMockSupabase({ user: AUTH })
    expect((await detail('abc')).status).toBe(404)
    expect((await detail('0')).status).toBe(404)
    expect(callOdoo).not.toHaveBeenCalled()
  })

  test('camino feliz: contacto, estado de cuenta del rango, notas de crédito, ventas y pagos', async () => {
    scriptOdoo()
    const res = await detail('24', '?from=&to=&filter=all')
    expect(res.status).toBe(200)
    const body = await readJson<CustomerDetailResponse>(res)
    expect(body.customer).toMatchObject({ id: 24, name: 'Andritz', vat: 'AND010101AAA', phone: '443 000 0000' })
    expect(body.statement?.lines.map((l) => [l.folio, l.status])).toEqual([['F-VIEJA', 'overdue'], ['F-FUTURA', 'upcoming']])
    expect(body.statement?.totals).toMatchObject({ overdue: 100, upcoming: 40, total: 140 })
    expect(body.statement?.currencies).toEqual([])
    expect(body.creditNotes).toMatchObject({ total: 30, count: 1 })
    expect(body.sales).toEqual([{ id: 9, folio: 'S00041', date: '2026-10-02', total: 1160, state: 'sale', invoiceStatus: 'to invoice' }])
    expect(body.payments).toEqual([{ id: 71, folio: 'PAY00068', date: '2026-10-01', amount: 580, currency: 'MXN', memo: 'F00387' }])
    // The activity reads are scoped to this partner only.
    const saleCall = vi.mocked(callOdoo).mock.calls.find((c) => c[0] === 'sale.order')!
    expect(saleCall[2].domain).toContainEqual(['partner_id', '=', 24])
  })

  test('facturado pero fuera de la lista → igual tiene estado de cuenta; desconocido → 404', async () => {
    scriptOdoo()
    const body = await readJson<CustomerDetailResponse>(await detail('55', '?from=&to=&filter=all'))
    expect(body.customer).toMatchObject({ id: 55, name: 'FieldCore', vat: null })
    expect(body.statement?.totals.total).toBe(500)

    expect((await detail('999')).status).toBe(404)
  })

  test('Odoo falla → 200 degradado', async () => {
    vi.mocked(callOdoo).mockRejectedValue(new OdooError('Odoo respondió 503', 503))
    const res = await detail('24')
    expect(res.status).toBe(200)
    expect(await readJson<CustomerDetailResponse>(res)).toMatchObject({ customer: null, reason: 'odoo_error' })
  })
})

describe('POST /api/clients/refresh', () => {
  test('purga clientes Y lo abierto que comparte con Finanzas, con expiración inmediata', async () => {
    const res = await refreshRoute.POST()
    expect(res.status).toBe(200)
    expect(revalidateTag).toHaveBeenCalledWith('odoo-customers', { expire: 0 })
    expect(revalidateTag).toHaveBeenCalledWith('finance-income', { expire: 0 })
  })

  test('sin usuario → 401 y no purga', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await refreshRoute.POST()).status).toBe(401)
    expect(revalidateTag).not.toHaveBeenCalled()
  })
})
