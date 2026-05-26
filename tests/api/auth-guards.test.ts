/**
 * Fase 1 — Auth / guards.
 *
 * Verifica la regla 10 del CLAUDE.md: TODA ruta protegida debe exigir
 * `requireAuth()` y devolver 401 sin usuario autenticado.
 *
 * La excepción es /approve/[token], que es pública (usa createAdminClient,
 * sin auth) y se valida por separado.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { makeRequest, makeParams } from '../helpers/request'

// ── Mocks de los módulos de Supabase ────────────────────────────────────
let activeClient: MockSupabaseClient
let adminClient: MockSupabaseClient

mock.module('@/lib/supabase/server', () => ({
  createClient: async () => activeClient,
}))
mock.module('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminClient,
}))

// ── Import dinámico de TODOS los handlers tras registrar los mocks ───────
const quotationsSave        = await import('@/app/api/quotations/save/route')
const quotationDelete       = await import('@/app/api/quotations/[id]/route')
const quotationUpdate       = await import('@/app/api/quotations/[id]/update/route')
const sendForApproval       = await import('@/app/api/quotations/[id]/send-for-approval/route')
const createOrder           = await import('@/app/api/quotations/[id]/create-order/route')
const ordersCreate          = await import('@/app/api/orders/create/route')
const orderByIdRoute        = await import('@/app/api/orders/[id]/route')
const orderCancel           = await import('@/app/api/orders/[id]/cancel/route')
const confirmReception      = await import('@/app/api/orders/[id]/confirm-reception/route')
const orderItems            = await import('@/app/api/orders/[id]/items/route')
const orderItemById         = await import('@/app/api/orders/[id]/items/[itemId]/route')
const orderStatus           = await import('@/app/api/orders/[id]/status/route')
const autoLearn             = await import('@/app/api/orders/auto-learn/route')
const ordersByQuotation     = await import('@/app/api/orders/by-quotation/[quotationId]/route')
const quotesLookup          = await import('@/app/api/quotes/lookup/route')
const productsImport        = await import('@/app/api/products/import/route')
const nextDymmsaCode        = await import('@/app/api/products/next-dymmsa-code/route')
const inventoryImport       = await import('@/app/api/inventory/import/route')
const approve               = await import('@/app/api/approve/[token]/route')

// ── Tabla de rutas protegidas: nombre + invocación con user:null ─────────
const protectedRoutes: Array<{ name: string; call: () => Promise<Response> }> = [
  { name: 'POST   /quotations/save',                  call: () => quotationsSave.POST(makeRequest({})) },
  { name: 'DELETE /quotations/[id]',                  call: () => quotationDelete.DELETE(makeRequest(), makeParams({ id: 'q1' })) },
  { name: 'PATCH  /quotations/[id]/update',           call: () => quotationUpdate.PATCH(makeRequest({}), makeParams({ id: 'q1' })) },
  { name: 'POST   /quotations/[id]/send-for-approval',call: () => sendForApproval.POST(makeRequest({}), makeParams({ id: 'q1' })) },
  { name: 'POST   /quotations/[id]/create-order',     call: () => createOrder.POST(makeRequest({}), makeParams({ id: 'q1' })) },
  { name: 'POST   /orders/create',                    call: () => ordersCreate.POST(makeRequest({})) },
  { name: 'PATCH  /orders/[id]',                      call: () => orderByIdRoute.PATCH(makeRequest({}), makeParams({ id: 'o1' })) },
  { name: 'DELETE /orders/[id]',                      call: () => orderByIdRoute.DELETE(makeRequest(), makeParams({ id: 'o1' })) },
  { name: 'POST   /orders/[id]/cancel',               call: () => orderCancel.POST(makeRequest({}), makeParams({ id: 'o1' })) },
  { name: 'POST   /orders/[id]/confirm-reception',    call: () => confirmReception.POST(makeRequest({}), makeParams({ id: 'o1' })) },
  { name: 'POST   /orders/[id]/items',                call: () => orderItems.POST(makeRequest({}), makeParams({ id: 'o1' })) },
  { name: 'PATCH  /orders/[id]/items/[itemId]',       call: () => orderItemById.PATCH(makeRequest({}), makeParams({ id: 'o1', itemId: 'i1' })) },
  { name: 'DELETE /orders/[id]/items/[itemId]',       call: () => orderItemById.DELETE(makeRequest(), makeParams({ id: 'o1', itemId: 'i1' })) },
  { name: 'PATCH  /orders/[id]/status',               call: () => orderStatus.PATCH(makeRequest({}), makeParams({ id: 'o1' })) },
  { name: 'POST   /orders/auto-learn',                call: () => autoLearn.POST(makeRequest({})) },
  { name: 'GET    /orders/by-quotation/[quotationId]',call: () => ordersByQuotation.GET(makeRequest(), makeParams({ quotationId: 'q1' })) },
  { name: 'POST   /quotes/lookup',                    call: () => quotesLookup.POST(makeRequest({})) },
  { name: 'POST   /products/import',                  call: () => productsImport.POST(makeRequest({})) },
  { name: 'GET    /products/next-dymmsa-code',        call: () => nextDymmsaCode.GET() },
  { name: 'POST   /inventory/import',                 call: () => inventoryImport.POST(makeRequest({})) },
]

describe('Auth guards — rutas protegidas exigen requireAuth (401 sin usuario)', () => {
  beforeEach(() => {
    activeClient = createMockSupabase({ user: null })
  })

  for (const route of protectedRoutes) {
    test(`${route.name} → 401`, async () => {
      const res = await route.call()
      expect(res.status).toBe(401)
    })
  }
})

describe('Ruta pública /approve/[token] — NO requiere auth', () => {
  test('GET devuelve la cotización por token sin usuario autenticado', async () => {
    adminClient = createMockSupabase({
      user: null, // sin auth: debe funcionar igual
      responses: {
        'quotations.select': {
          data: { id: 'q1', customer_name: 'ACME', status: 'sent_for_approval', total_amount: 100, created_at: '2026-05-25', quotation_items: [] },
          error: null,
        },
      },
    })
    const res = await approve.GET(makeRequest(), makeParams({ token: 'tok-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('q1')
  })

  test('GET devuelve 404 cuando el token no existe', async () => {
    adminClient = createMockSupabase({
      user: null,
      responses: { 'quotations.select': { data: null, error: { message: 'not found' } } },
    })
    const res = await approve.GET(makeRequest(), makeParams({ token: 'bad' }))
    expect(res.status).toBe(404)
  })
})
