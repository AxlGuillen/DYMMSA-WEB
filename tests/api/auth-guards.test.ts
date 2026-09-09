/** Every protected route must require requireAuth() and answer 401 with no user.
 *  /approve/[token] is the public exception and is covered separately. */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseServer, injectSupabaseAdmin } from '../helpers/setup'
import { makeRequest, makeParams } from '../helpers/request'
import { AUTH } from '../helpers/factories'

// Static import of every handler (vi.mock hoists above it).
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
import * as payablesRoute from '@/app/api/payables/route'
import * as payableById from '@/app/api/payables/[id]/route'
import * as payablesOverview from '@/app/api/payables/overview/route'
import * as profileRoute from '@/app/api/profile/route'
import * as profilesRoute from '@/app/api/profiles/route'
import * as profileById from '@/app/api/profiles/[id]/route'
import * as timeEntries from '@/app/api/time-entries/route'
import * as timeEntryById from '@/app/api/time-entries/[id]/route'
import * as timeEntriesImport from '@/app/api/time-entries/import/route'
import * as timeImports from '@/app/api/time-entries/imports/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

let activeClient: MockSupabaseClient
let adminClient: MockSupabaseClient

injectSupabaseServer(() => activeClient)
injectSupabaseAdmin(() => adminClient)

// Admin-only routes (#93): 401 with no user, 403 for a member.
const adminRoutes: Array<{ name: string; call: () => Promise<Response> }> = [
  { name: 'GET    /profiles',                         call: () => profilesRoute.GET() },
  { name: 'PATCH  /profiles/[id]',                    call: () => profileById.PATCH(makeRequest({ role: 'member' }, { method: 'PATCH' }), makeParams({ id: 'u1' })) },
  { name: 'POST   /time-entries',                     call: () => timeEntries.POST(makeRequest({})) },
  { name: 'PATCH  /time-entries/[id]',                call: () => timeEntryById.PATCH(makeRequest({ note: 'x' }, { method: 'PATCH' }), makeParams({ id: 't1' })) },
  { name: 'DELETE /time-entries/[id]',                call: () => timeEntryById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: 't1' })) },
  { name: 'POST   /time-entries/import',              call: () => timeEntriesImport.POST(makeRequest({})) },
]

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
  { name: 'GET    /payables',                         call: () => payablesRoute.GET(makeRequest(undefined, { url: 'http://x/api/payables' })) },
  { name: 'POST   /payables',                         call: () => payablesRoute.POST(makeRequest({})) },
  { name: 'PATCH  /payables/[id]',                    call: () => payableById.PATCH(makeRequest({}, { method: 'PATCH' }), makeParams({ id: 'p1' })) },
  { name: 'DELETE /payables/[id]',                    call: () => payableById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: 'p1' })) },
  { name: 'GET    /payables/overview',                call: () => payablesOverview.GET(makeRequest(undefined, { url: 'http://x/api/payables/overview' })) },
  { name: 'GET    /profile',                          call: () => profileRoute.GET() },
  { name: 'GET    /time-entries',                     call: () => timeEntries.GET(makeRequest(undefined, { url: 'http://x/api/time-entries' })) },
  { name: 'GET    /time-entries/imports',             call: () => timeImports.GET() },
  ...adminRoutes,
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

describe('Role guards — rutas de admin responden 403 a un member', () => {
  beforeEach(() => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'profiles.select': { data: { id: AUTH.id, role: 'member', display_name: 'Tania' }, error: null } },
    })
  })

  for (const route of adminRoutes) {
    test(`${route.name} → 403`, async () => {
      const res = await route.call()
      expect(res.status).toBe(403)
    })
  }
})

describe('Ruta pública /approve/[token] — NO requiere auth', () => {
  test('GET devuelve la cotización por token sin usuario autenticado', async () => {
    adminClient = createMockSupabase({
      user: null, // no auth: must still work
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
