/** POST /approve/[token], public and on the admin client: save progress vs finalize in one DB function
 *  (#157), stale ids → 409 writing nothing, approved_at keeps the first approval, plus the guards. */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseAdmin } from '../helpers/setup'
import { makeRequest, makeParams } from '../helpers/request'
import { quotationDb, lineId, TOKEN } from '../helpers/quotation-rpc'
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

const post = (body: unknown, token = TOKEN) =>
  approve.POST(makeRequest(body, { method: 'POST' }), makeParams({ token }))

/** Under review: 2 approvable products (100×2, 50×1), 1 "not sold" and a separator. */
function sentDb(overrides: Parameters<typeof quotationDb>[0] = {}) {
  const db = quotationDb({
    quotation: { status: 'sent_for_approval', total_amount: 1500 },
    lines: [
      { etm: 'P1', unit_price: 100, quantity: 2 },
      { etm: 'P2', unit_price: 50, quantity: 1, is_sold: true },
      { etm: 'NO', is_sold: false },
      { item_type: 'separator', section_label: 'Obra' },
    ],
    ...overrides,
  })
  adminClient = db.client
  return db
}

describe('POST /approve/[token]', () => {
  test('404 si el token no existe', async () => {
    sentDb()
    const res = await post({ approvedIds: [lineId(1)], finalize: true }, '99999999-9999-4999-8999-999999999999')
    expect(res.status).toBe(404)
  })

  test('404 si el token no tiene forma de uuid (sin pegarle a la BD)', async () => {
    const db = sentDb()
    const res = await post({ approvedIds: [], finalize: true }, 'tok-1')
    expect(res.status).toBe(404)
    expect(db.client.didCall('quotations', 'select')).toBe(false)
  })

  test('400 si la cotización ya fue procesada', async () => {
    const db = sentDb({ quotation: { status: 'approved' } })
    const res = await post({ approvedIds: [lineId(1)], finalize: true })
    expect(res.status).toBe(400)
    expect(db.rpcParams('submit_quotation_approval')).toHaveLength(0)
  })

  test('400 si approvedIds no es arreglo, trae algo que no es uuid o el body no es JSON', async () => {
    const db = sentDb()
    expect((await post({ approvedIds: 'x', finalize: false })).status).toBe(400)
    expect((await post({ approvedIds: ['i1'], finalize: false })).status).toBe(400)
    expect((await post('no-es-un-objeto')).status).toBe(400)
    expect(db.rpcParams('submit_quotation_approval')).toHaveLength(0)
    expect(db.lines().map((l) => l.is_approved)).toEqual([null, null, null, null])
  })

  test('guardar avance: aprobados=true, resto=null, sin tocar el status', async () => {
    const db = sentDb({
      lines: [
        { etm: 'P1', unit_price: 100, quantity: 2, is_approved: true },
        { etm: 'P2', unit_price: 50, quantity: 1 },
      ],
    })
    const res = await post({ approvedIds: [lineId(2), lineId(2)], finalize: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ saved: true, finalized: false, approvedCount: 1 })
    expect(db.lines().map((l) => l.is_approved)).toEqual([null, true])
    expect(db.quotation.status).toBe('sent_for_approval') // the link stays alive
    expect(db.rpcParams('submit_quotation_approval')).toEqual([
      { p_token: TOKEN, p_approved_ids: [lineId(2)], p_finalize: false },
    ])
  })

  test('finalizar con aprobados: resto=false, status approved + approved_at; "no lo vendemos" y separador intactos', async () => {
    const db = sentDb()
    const res = await post({ approvedIds: [lineId(1)], finalize: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ finalized: true, status: 'approved' })
    expect(db.lines().map((l) => l.is_approved)).toEqual([true, false, null, null])
    expect(db.quotation.status).toBe('approved')
    expect(db.quotation.approved_at).toBeTruthy()
  })

  test('REGLA (#157): finalizar sin aprobados → rejected y CONSERVA el approved_at de la primera aprobación', async () => {
    const first = '2026-09-01T10:00:00.000Z'
    const db = sentDb({ quotation: { status: 'sent_for_approval', approved_at: first } })
    const res = await post({ approvedIds: [], finalize: true })
    expect((await res.json()).status).toBe('rejected')
    expect(db.quotation.status).toBe('rejected')
    expect(db.quotation.approved_at).toBe(first)
  })

  test('REGLA (#157): re-aprobar no vuelve a sellar approved_at', async () => {
    const first = '2026-09-01T10:00:00.000Z'
    const db = sentDb({ quotation: { status: 'sent_for_approval', approved_at: first } })
    await post({ approvedIds: [lineId(1)], finalize: true })
    expect(db.quotation.approved_at).toBe(first)
  })

  test('REGLA (#157): un id que ya no es línea de la cotización → 409 claro y NO escribe nada', async () => {
    const db = sentDb({
      lines: [
        { etm: 'P1', unit_price: 100, quantity: 2, is_approved: true },
        { etm: 'P2', unit_price: 50, quantity: 1 },
      ],
    })
    // The client's page still shows a line DYMMSA removed.
    const res = await post({ approvedIds: [lineId(1), '44444444-4444-4444-8444-444444444444'], finalize: true })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('stale_items')
    expect(body.message).toMatch(/recarga la página/i)
    expect(db.lines().map((l) => l.is_approved)).toEqual([true, null])
    expect(db.quotation.status).toBe('sent_for_approval')
    expect(mockNotify).not.toHaveBeenCalled()
  })

  test('REGLA (#157): guardar avance con ids viejos tampoco borra lo ya guardado', async () => {
    const db = sentDb({ lines: [{ etm: 'P1', unit_price: 100, quantity: 2, is_approved: true }] })
    const res = await post({ approvedIds: ['44444444-4444-4444-8444-444444444444'], finalize: false })
    expect(res.status).toBe(409)
    expect(db.lines()[0].is_approved).toBe(true)
  })

  test('aprobar un separador o un "no lo vendemos" también es 409: no son líneas aprobables', async () => {
    const db = sentDb()
    expect((await post({ approvedIds: [lineId(3)], finalize: true })).status).toBe(409) // is_sold=false
    expect((await post({ approvedIds: [lineId(4)], finalize: true })).status).toBe(409) // separator
    expect(db.quotation.status).toBe('sent_for_approval')
  })

  test('REGLA: aprobación PARCIAL notifica el total de lo aprobado, no el de toda la cotización', async () => {
    // total_amount is 1500 for the whole quotation, but the client approved 100×2 + 50×1 → 250.
    sentDb()
    await post({ approvedIds: [lineId(1), lineId(2)], finalize: true })
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith({
      customerName: 'ACME',
      quotationName: 'COT-001',
      total: 250,
      approvedCount: 2,
      quotationId: expect.any(String),
    })
  })

  test('si la lectura de ítems aprobados falla, cae al total_amount de la cotización', async () => {
    sentDb({ responses: { 'quotation_items.select': { data: null, error: { message: 'timeout' } } } })
    await post({ approvedIds: [lineId(1), lineId(2)], finalize: true })
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ total: 1500, approvedCount: 2 }))
  })

  test('guardar avance NO envía notificación', async () => {
    sentDb()
    await post({ approvedIds: [lineId(1)], finalize: false })
    expect(mockNotify).not.toHaveBeenCalled()
  })

  test('finalizar sin aprobados (rejected) NO envía notificación', async () => {
    sentDb()
    await post({ approvedIds: [], finalize: true })
    expect(mockNotify).not.toHaveBeenCalled()
  })

  test('si la notificación falla, el endpoint igual responde 200', async () => {
    sentDb()
    mockNotify.mockRejectedValueOnce(new Error('resend down'))
    const res = await post({ approvedIds: [lineId(1)], finalize: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ finalized: true, status: 'approved' })
  })

  test('finalizar concurrente: si otro request ya finalizó entre la lectura y el lock → 409 y NO notifica', async () => {
    const db = sentDb()
    db.client.rpc = async () => ({ data: null, error: { code: 'P0001', message: 'quotation_processed' } })
    const res = await post({ approvedIds: [lineId(1)], finalize: true })
    expect(res.status).toBe(409)
    expect((await res.json()).message).toBe('Esta cotización ya fue procesada')
    expect(mockNotify).not.toHaveBeenCalled()
  })

  test('un error inesperado de la función → 500 genérico', async () => {
    sentDb({ approvalError: { message: 'connection reset' } })
    const res = await post({ approvedIds: [lineId(1)], finalize: true })
    expect(res.status).toBe(500)
    expect(mockNotify).not.toHaveBeenCalled()
  })
})
