/**
 * POST /approve/[token] — decisiones del cliente (público, admin client).
 *   - guardar avance (finalize=false): reset a null + aprobar; NO cambia status
 *   - finalizar (finalize=true): reset a false + aprobar; status + approved_at
 *   - guardas: token inexistente (404), ya procesada (400), payload inválido (400)
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseAdmin } from '../helpers/setup'
import { makeRequest, makeParams } from '../helpers/request'
import * as approve from '@/app/api/approve/[token]/route'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

let adminClient: MockSupabaseClient
injectSupabaseAdmin(() => adminClient)

const params = makeParams({ token: 'tok-1' })
const post = (body: unknown) => approve.POST(makeRequest(body, { method: 'POST' }), params)

function sentClient() {
  return createMockSupabase({
    responses: {
      'quotations.select': { data: { id: 'q1', status: 'sent_for_approval' }, error: null },
      'quotation_items.update': { data: null, error: null },
      'quotations.update': { data: null, error: null },
    },
  })
}

describe('POST /approve/[token]', () => {
  test('404 si el token no existe', async () => {
    adminClient = createMockSupabase({ responses: { 'quotations.select': { data: null, error: { message: 'nf' } } } })
    const res = await post({ approvedIds: ['i1'], finalize: true })
    expect(res.status).toBe(404)
  })

  test('400 si la cotización ya fue procesada', async () => {
    adminClient = createMockSupabase({ responses: { 'quotations.select': { data: { id: 'q1', status: 'approved' }, error: null } } })
    const res = await post({ approvedIds: ['i1'], finalize: true })
    expect(res.status).toBe(400)
  })

  test('400 si approvedIds no es arreglo', async () => {
    adminClient = sentClient()
    const res = await post({ approvedIds: 'x', finalize: false })
    expect(res.status).toBe(400)
  })

  test('guardar avance: reset a null + aprobar, sin tocar el status', async () => {
    adminClient = sentClient()
    const res = await post({ approvedIds: ['i1', 'i2'], finalize: false })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ saved: true, finalized: false, approvedCount: 2 })

    const updates = adminClient.callsTo('quotation_items', 'update')
    expect(updates[0].payload).toMatchObject({ is_approved: null }) // reset = pendiente
    expect(updates[1].payload).toMatchObject({ is_approved: true }) // aprobados
    // NO cambia el status de la cotización
    expect(adminClient.didCall('quotations', 'update')).toBe(false)
  })

  test('finalizar con aprobados: reset a false, status approved + approved_at', async () => {
    adminClient = sentClient()
    const res = await post({ approvedIds: ['i1'], finalize: true })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ finalized: true, status: 'approved' })

    const resetPayload = adminClient.callsTo('quotation_items', 'update')[0].payload as Record<string, unknown>
    expect(resetPayload.is_approved).toBe(false) // reset = rechazado

    const q = adminClient.updatePayload<Record<string, unknown>>('quotations')
    expect(q.status).toBe('approved')
    expect(q.approved_at).toBeTruthy()
  })

  test('finalizar sin aprobados: status rejected, approved_at null', async () => {
    adminClient = sentClient()
    const res = await post({ approvedIds: [], finalize: true })
    const body = await res.json()
    expect(body.status).toBe('rejected')
    const q = adminClient.updatePayload<Record<string, unknown>>('quotations')
    expect(q.status).toBe('rejected')
    expect(q.approved_at).toBeNull()
  })
})
