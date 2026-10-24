/** Public approval against local Supabase (ADR-021): the route uses the admin client, so a real one is injected. */
import { describe, test, expect, beforeEach, afterAll, vi } from 'vitest'
import { injectSupabaseAdmin } from '../helpers/setup'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import { serviceClient } from './helpers/clients'
import { resetDb, sql, seedQuotation, closePool } from './helpers/db'
import * as approve from '@/app/api/approve/[token]/route'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
injectSupabaseAdmin(() => serviceClient() as never)

beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

const post = (token: string, body: unknown) =>
  approve.POST(makeRequest(body, { method: 'POST' }), makeParams({ token }))

/** Quotation under review: 2 approvable products + 1 not-sold. */
async function seedForApproval() {
  return seedQuotation({
    status: 'sent_for_approval',
    items: [
      { etm: 'P1', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, is_sold: true },
      { etm: 'P2', model_code: '60002', brand: 'URREA', unit_price: 50, quantity: 1, is_sold: true },
      { etm: 'NO', model_code: '60004', brand: 'URREA', unit_price: null, quantity: null, is_sold: false },
    ],
  })
}

describe('POST /approve/[token] (integración local)', () => {
  test('guardar avance: aprueba los seleccionados, resto=null y NO cambia el status', async () => {
    const { token, itemIds } = await seedForApproval()

    const res = await post(token, { approvedIds: [itemIds[0]], finalize: false })
    expect(res.status).toBe(200)
    expect(await readJson<{ finalized: boolean }>(res)).toMatchObject({ finalized: false })

    const items = await sql<{ etm: string; is_approved: boolean | null }>(
      'SELECT etm, is_approved FROM quotation_items ORDER BY sort_order',
    )
    expect(items).toEqual([
      { etm: 'P1', is_approved: true },
      { etm: 'P2', is_approved: null },
      { etm: 'NO', is_approved: null },   // not-sold: never touched
    ])
    const [q] = await sql<{ status: string }>('SELECT status FROM quotations')
    expect(q.status).toBe('sent_for_approval') // the link stays alive
  })

  test('finalizar con aprobaciones → status=approved, resto=false, approved_at sellado, no-sell intacto', async () => {
    const { token, itemIds } = await seedForApproval()

    const res = await post(token, { approvedIds: [itemIds[0]], finalize: true })
    expect(res.status).toBe(200)
    expect(await readJson<{ status: string }>(res)).toMatchObject({ status: 'approved' })

    const items = await sql<{ etm: string; is_approved: boolean | null }>(
      'SELECT etm, is_approved FROM quotation_items ORDER BY sort_order',
    )
    expect(items).toEqual([
      { etm: 'P1', is_approved: true },
      { etm: 'P2', is_approved: false },
      { etm: 'NO', is_approved: null },   // excluded (is_sold=false)
    ])
    const [q] = await sql<{ status: string; approved_at: string | null }>('SELECT status, approved_at FROM quotations')
    expect(q.status).toBe('approved')
    expect(q.approved_at).not.toBeNull()
  })

  test('finalizar SIN aprobaciones → status=rejected y approved_at sigue vacío si nunca se aprobó', async () => {
    const { token } = await seedForApproval()
    const res = await post(token, { approvedIds: [], finalize: true })
    expect(res.status).toBe(200)
    const [q] = await sql<{ status: string; approved_at: string | null }>('SELECT status, approved_at FROM quotations')
    expect(q.status).toBe('rejected')
    expect(q.approved_at).toBeNull()
  })

  test('REGLA (#157): approved_at conserva la PRIMERA aprobación: ni el rechazo lo borra ni la re-aprobación lo mueve', async () => {
    const first = '2026-09-01T10:00:00.000Z'
    const rejected = await seedForApproval()
    await sql('UPDATE quotations SET approved_at = $1 WHERE id = $2', [first, rejected.id])
    expect((await post(rejected.token, { approvedIds: [], finalize: true })).status).toBe(200)

    const reapproved = await seedForApproval()
    await sql('UPDATE quotations SET approved_at = $1 WHERE id = $2', [first, reapproved.id])
    expect((await post(reapproved.token, { approvedIds: [reapproved.itemIds[0]], finalize: true })).status).toBe(200)

    const rows = await sql<{ id: string; status: string; approved_at: Date }>('SELECT id, status, approved_at FROM quotations')
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get(rejected.id)).toMatchObject({ status: 'rejected' })
    expect(byId.get(reapproved.id)).toMatchObject({ status: 'approved' })
    expect(byId.get(rejected.id)?.approved_at.toISOString()).toBe(first)
    expect(byId.get(reapproved.id)?.approved_at.toISOString()).toBe(first)
  })

  test('REGLA (#157): ids que ya no son líneas de la cotización → 409 claro y NO escribe nada', async () => {
    const { id, token, itemIds } = await seedForApproval()
    await sql('UPDATE quotation_items SET is_approved = true WHERE id = $1', [itemIds[0]]) // saved progress
    // DYMMSA removed P2 while the client had the page open.
    await sql('DELETE FROM quotation_items WHERE id = $1', [itemIds[1]])

    for (const finalize of [false, true]) {
      const res = await post(token, { approvedIds: [itemIds[0], itemIds[1]], finalize })
      expect(res.status).toBe(409)
      expect(await readJson<{ code: string; message: string }>(res)).toMatchObject({
        code: 'stale_items', message: expect.stringMatching(/recarga la página/i),
      })
    }

    const items = await sql<{ etm: string; is_approved: boolean | null }>(
      'SELECT etm, is_approved FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order', [id],
    )
    expect(items).toEqual([{ etm: 'P1', is_approved: true }, { etm: 'NO', is_approved: null }])
    const [q] = await sql<{ status: string; approved_at: string | null }>('SELECT status, approved_at FROM quotations')
    expect(q).toEqual({ status: 'sent_for_approval', approved_at: null })
  })

  test('un "no lo vendemos" no es aprobable: mandarlo es 409, no se aprueba a escondidas', async () => {
    const { token, itemIds } = await seedForApproval()
    const res = await post(token, { approvedIds: [itemIds[2]], finalize: true })
    expect(res.status).toBe(409)
    const [noSell] = await sql<{ is_approved: boolean | null }>('SELECT is_approved FROM quotation_items WHERE id = $1', [itemIds[2]])
    expect(noSell.is_approved).toBeNull()
  })

  test('cotización ya procesada (approved) → 400', async () => {
    const { token } = await seedQuotation({ status: 'approved', items: [{ etm: 'A', quantity: 1, unit_price: 1 }] })
    const res = await post(token, { approvedIds: [], finalize: true })
    expect(res.status).toBe(400)
  })
})
