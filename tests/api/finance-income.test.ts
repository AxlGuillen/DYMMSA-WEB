/** /api/finance/income (#94): auth, month validation, Odoo degradation to 200/null, cache purge on refresh. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { revalidateTag } from 'next/cache'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, readJson } from '../helpers/request'
import { AUTH } from '../helpers/factories'
import { callOdoo, OdooError } from '@/lib/odoo/client'
import type { IncomeOverviewResponse } from '@/lib/income'
import * as incomeRoute from '@/app/api/finance/income/route'
import * as refreshRoute from '@/app/api/finance/income/refresh/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// Keeps OdooError real (instanceof in the handler) and stubs only the singleton caller.
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

const PAY00068 = {
  id: 71, name: 'PAY00068', partner_id: [24, 'Andritz'], date: '2026-08-12', amount: 59868.07,
  payment_type: 'inbound', state: 'paid', memo: false, currency_id: [33, 'MXN'],
}
const OPEN_INVOICE = {
  id: 780, name: 'F00387', partner_id: [24, 'Andritz'], invoice_date: '2026-08-11', invoice_date_due: '2026-05-10',
  amount_total: 18781.1, amount_residual: 18781.1, payment_state: 'not_paid',
}

function scriptOdoo() {
  vi.mocked(callOdoo).mockImplementation(async (model) => {
    if (model === 'account.payment') return [PAY00068]
    if (model === 'account.move') return [OPEN_INVOICE]
    throw new Error(`modelo inesperado ${model}`)
  })
}

const get = (query = '?month=2026-08') =>
  incomeRoute.GET(makeRequest(undefined, { url: `http://x/api/finance/income${query}` }))
const post = (query = '?month=2026-08') =>
  refreshRoute.POST(makeRequest(undefined, { method: 'POST', url: `http://x/api/finance/income/refresh${query}` }))

beforeEach(() => {
  activeClient = createMockSupabase({ user: AUTH })
  vi.mocked(callOdoo).mockReset()
  vi.mocked(revalidateTag).mockClear()
  vi.stubEnv('ODOO_URL', 'https://dymmsa.odoo.com')
  vi.stubEnv('ODOO_API_KEY', 'test-key')
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/finance/income', () => {
  test('sin usuario → 401', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await get()).status).toBe(401)
  })

  test('mes inválido → 400', async () => {
    expect((await get('?month=agosto')).status).toBe(400)
  })

  test('Odoo sin configurar → 200 con income null y sin tocar Odoo', async () => {
    vi.stubEnv('ODOO_URL', '')
    const res = await get()
    expect(res.status).toBe(200)
    const body = await readJson<IncomeOverviewResponse>(res)
    expect(body.income).toBeNull()
    expect(body.unavailable?.reason).toBe('not_configured')
    expect(callOdoo).not.toHaveBeenCalled()
  })

  test('Odoo falla → 200 degradado con odoo_error (nunca 500)', async () => {
    vi.mocked(callOdoo).mockRejectedValue(new OdooError('Odoo respondió 503', 503))
    const res = await get()
    expect(res.status).toBe(200)
    const body = await readJson<IncomeOverviewResponse>(res)
    expect(body.income).toBeNull()
    expect(body.unavailable).toEqual({ reason: 'odoo_error', message: expect.stringMatching(/solo los egresos/) })
  })

  test('error que no es de Odoo → 500', async () => {
    vi.mocked(callOdoo).mockRejectedValue(new Error('boom'))
    expect((await get()).status).toBe(500)
  })

  test('camino feliz: cobros del mes, por cobrar/vencido y fetchedAt', async () => {
    scriptOdoo()
    const res = await get()
    expect(res.status).toBe(200)
    const body = await readJson<IncomeOverviewResponse>(res)
    expect(body.month).toBe('2026-08')
    expect(body.income).toMatchObject({
      collectedTotal: 59868.07, collectedCount: 1,
      overdueTotal: 18781.1, overdueCount: 1,
      receivableTotal: 0, receivableCount: 0,
      truncated: false,
    })
    expect(body.collections).toEqual([expect.objectContaining({ folio: 'PAY00068', customer: 'Andritz', amount: 59868.07 })])
    expect(typeof body.fetchedAt).toBe('string')
    expect(callOdoo).toHaveBeenCalledTimes(2)
    const paymentCall = vi.mocked(callOdoo).mock.calls.find((c) => c[0] === 'account.payment')!
    expect(paymentCall[2].domain).toContainEqual(['date', '<', '2026-09-01'])
  })

  test('sin month usa el mes actual', async () => {
    scriptOdoo()
    const body = await readJson<IncomeOverviewResponse>(await get(''))
    expect(body.month).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('POST /api/finance/income/refresh', () => {
  test('purga el tag con expiración inmediata y responde con una lectura fresca', async () => {
    scriptOdoo()
    const res = await post()
    expect(res.status).toBe(200)
    expect(revalidateTag).toHaveBeenCalledWith('finance-income', { expire: 0 })
    const body = await readJson<IncomeOverviewResponse>(res)
    expect(body.income?.collectedTotal).toBe(59868.07)
    expect(callOdoo).toHaveBeenCalledTimes(2)
  })

  test('sin usuario → 401 y no purga', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await post()).status).toBe(401)
    expect(revalidateTag).not.toHaveBeenCalled()
  })
})
