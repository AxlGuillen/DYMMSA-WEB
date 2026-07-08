/**
 * POST /approve/[token] — decisiones del cliente (público, admin client).
 *   - guardar avance (finalize=false): reset a null + aprobar; NO cambia status
 *   - finalizar (finalize=true): reset a false + aprobar; status + approved_at
 *   - guardas: token inexistente (404), ya procesada (400), payload inválido (400)
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseAdmin } from '../helpers/setup'
import { makeRequest, makeParams } from '../helpers/request'
import * as approve from '@/app/api/approve/[token]/route'
import { sendApprovalNotification } from '@/lib/email/send-approval-notification'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/email/send-approval-notification', () => ({
  sendApprovalNotification: vi.fn().mockResolvedValue({ ok: true }),
}))

const mockNotify = vi.mocked(sendApprovalNotification)
beforeEach(() => mockNotify.mockClear())

let adminClient: MockSupabaseClient
injectSupabaseAdmin(() => adminClient)

const params = makeParams({ token: 'tok-1' })
const post = (body: unknown) => approve.POST(makeRequest(body, { method: 'POST' }), params)

function sentClient() {
  return createMockSupabase({
    responses: {
      'quotations.select': {
        data: { id: 'q1', status: 'sent_for_approval', name: 'COT-001', customer_name: 'ACME', total_amount: 1500 },
        error: null,
      },
      'quotation_items.update': { data: null, error: null },
      'quotations.update': { data: [{ id: 'q1' }], error: null },
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

  test('REGLA: aprobación PARCIAL notifica el total de lo aprobado, no el de toda la cotización', async () => {
    // total_amount=1500 (cotización completa), pero el cliente solo aprobó 2 ítems
    // que suman 250 → el correo debe decir 250.
    adminClient = createMockSupabase({
      responses: {
        'quotations.select': {
          data: { id: 'q1', status: 'sent_for_approval', name: 'COT-001', customer_name: 'ACME', total_amount: 1500 },
          error: null,
        },
        'quotation_items.update': { data: null, error: null },
        'quotation_items.select': {
          data: [
            { unit_price: 100, quantity: 2, item_type: 'product', is_approved: true, is_sold: null },
            { unit_price: 50, quantity: 1, item_type: 'product', is_approved: true, is_sold: true },
          ],
          error: null,
        },
        'quotations.update': { data: [{ id: 'q1' }], error: null },
      },
    })
    await post({ approvedIds: ['i1', 'i2'], finalize: true })
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith({
      customerName: 'ACME',
      quotationName: 'COT-001',
      total: 250,
      approvedCount: 2,
      quotationId: 'q1',
    })
  })

  test('si la lectura de ítems aprobados falla, cae al total_amount de la cotización', async () => {
    // sentClient no configura quotation_items.select → data null → fallback.
    adminClient = sentClient()
    await post({ approvedIds: ['i1', 'i2'], finalize: true })
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ total: 1500, approvedCount: 2 }),
    )
  })

  test('guardar avance NO envía notificación', async () => {
    adminClient = sentClient()
    await post({ approvedIds: ['i1'], finalize: false })
    expect(mockNotify).not.toHaveBeenCalled()
  })

  test('finalizar sin aprobados (rejected) NO envía notificación', async () => {
    adminClient = sentClient()
    await post({ approvedIds: [], finalize: true })
    expect(mockNotify).not.toHaveBeenCalled()
  })

  test('si la notificación falla, el endpoint igual responde 200', async () => {
    adminClient = sentClient()
    mockNotify.mockRejectedValueOnce(new Error('resend down'))
    const res = await post({ approvedIds: ['i1'], finalize: true })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ finalized: true, status: 'approved' })
  })

  test('finalizar concurrente: si otro request ya finalizó (0 filas), responde 409 y NO notifica', async () => {
    // La guarda .eq('status','sent_for_approval') matchea 0 filas → update devuelve [].
    adminClient = createMockSupabase({
      responses: {
        'quotations.select': {
          data: { id: 'q1', status: 'sent_for_approval', name: 'COT-001', customer_name: 'ACME', total_amount: 1500 },
          error: null,
        },
        'quotation_items.update': { data: null, error: null },
        'quotations.update': { data: [], error: null },
      },
    })
    const res = await post({ approvedIds: ['i1'], finalize: true })
    expect(res.status).toBe(409)
    expect(mockNotify).not.toHaveBeenCalled()
  })
})
