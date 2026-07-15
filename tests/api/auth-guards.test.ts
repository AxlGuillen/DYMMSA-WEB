/**
 * Fase 1 — Auth / guards.
 *
 * Verifica la regla 10 del CLAUDE.md: TODA ruta protegida debe exigir
 * `requireAuth()` y devolver 401 sin usuario autenticado.
 *
 * La excepción es /approve/[token], que es pública (usa createAdminClient,
 * sin auth) y se valida por separado.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseServer, injectSupabaseAdmin } from '../helpers/setup'
import { makeRequest, makeParams } from '../helpers/request'

// ── Import estático de TODOS los handlers (vi.mock se hoista por encima) ──
import * as quotationsSave from '@/app/api/quotations/save/route'
import * as quotationDelete from '@/app/api/quotations/[id]/route'
import * as quotationUpdate from '@/app/api/quotations/[id]/update/route'
import * as sendForApproval from '@/app/api/quotations/[id]/send-for-approval/route'
import * as createOrder from '@/app/api/quotations/[id]/create-order/route'
import * as ordersCreate from '@/app/api/orders/create/route'
import * as orderByIdRoute from '@/app/api/orders/[id]/route'
import * as orderCancel from '@/app/api/orders/[id]/cancel/route'
import * as confirmReception from '@/app/api/orders/[id]/confirm-reception/route'
import * as orderItems from '@/app/api/orders/[id]/items/route'
import * as orderItemById from '@/app/api/orders/[id]/items/[itemId]/route'
import * as orderStatus from '@/app/api/orders/[id]/status/route'
import * as autoLearn from '@/app/api/orders/auto-learn/route'
import * as ordersByQuotation from '@/app/api/orders/by-quotation/[quotationId]/route'
import * as purchasePlan from '@/app/api/orders/[id]/purchase-plan/route'
import * as purchaseDecisions from '@/app/api/orders/[id]/purchase-decisions/route'
import * as settings from '@/app/api/settings/route'
import * as quotesLookup from '@/app/api/quotes/lookup/route'
import * as productsImport from '@/app/api/products/import/route'
import * as nextDymmsaCode from '@/app/api/products/next-dymmsa-code/route'
import * as inventoryImport from '@/app/api/inventory/import/route'
import * as approve from '@/app/api/approve/[token]/route'

// ── Mocks de los módulos de Supabase ────────────────────────────────────
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

let activeClient: MockSupabaseClient
let adminClient: MockSupabaseClient

injectSupabaseServer(() => activeClient)
injectSupabaseAdmin(() => adminClient)

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
  { name: 'GET    /orders/[id]/purchase-plan',        call: () => purchasePlan.GET(makeRequest(), makeParams({ id: 'o1' })) },
  { name: 'PUT    /orders/[id]/purchase-decisions',   call: () => purchaseDecisions.PUT(makeRequest({ decisions: [] }, { method: 'PUT' }), makeParams({ id: 'o1' })) },
  { name: 'GET    /settings',                         call: () => settings.GET(makeRequest()) },
  { name: 'PATCH  /settings',                         call: () => settings.PATCH(makeRequest({}, { method: 'PATCH' })) },
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
