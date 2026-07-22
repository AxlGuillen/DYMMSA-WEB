/**
 * Integración (Fase C1 · capa 3 — aprobación pública) contra el Supabase LOCAL.
 * La ruta /approve/[token] usa el ADMIN client (service role): se inyecta uno
 * real. Cubre guardar-avance vs finalizar, exclusión de "no lo vendemos" y el
 * sellado de approved_at.
 */
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

/** Cotización en revisión con 2 productos aprobables + 1 "no lo vendemos". */
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
      { etm: 'P1', is_approved: true },   // seleccionado
      { etm: 'P2', is_approved: null },   // pendiente
      { etm: 'NO', is_approved: null },   // "no lo vendemos": nunca se toca
    ])
    const [q] = await sql<{ status: string }>('SELECT status FROM quotations')
    expect(q.status).toBe('sent_for_approval') // el link sigue vivo
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
      { etm: 'P2', is_approved: false },  // rechazado al finalizar
      { etm: 'NO', is_approved: null },   // excluido (is_sold=false)
    ])
    const [q] = await sql<{ status: string; approved_at: string | null }>('SELECT status, approved_at FROM quotations')
    expect(q.status).toBe('approved')
    expect(q.approved_at).not.toBeNull()
  })

  test('finalizar SIN aprobaciones → status=rejected y approved_at null', async () => {
    const { token } = await seedForApproval()
    const res = await post(token, { approvedIds: [], finalize: true })
    expect(res.status).toBe(200)
    const [q] = await sql<{ status: string; approved_at: string | null }>('SELECT status, approved_at FROM quotations')
    expect(q.status).toBe('rejected')
    expect(q.approved_at).toBeNull()
  })

  test('cotización ya procesada (approved) → 400', async () => {
    const { token } = await seedQuotation({ status: 'approved', items: [{ etm: 'A', quantity: 1, unit_price: 1 }] })
    const res = await post(token, { approvedIds: [], finalize: true })
    expect(res.status).toBe(400)
  })
})
