/**
 * Integración (Fase C1 · capa 2 — cotizaciones) contra el Supabase LOCAL.
 * Enfocada en transiciones de estado REALES: regeneración de token, sellado y
 * preservación de approved_at, y la guarda de reapertura de convertidas.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import { authedClient } from './helpers/clients'
import { resetDb, sql, seedQuotation, closePool } from './helpers/db'
import * as statusRoute from '@/app/api/quotations/[id]/status/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

beforeAll(async () => { activeClient = await authedClient() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

const patchStatus = (id: string, status: string) =>
  statusRoute.PATCH(makeRequest({ status }, { method: 'PATCH' }), makeParams({ id }))

describe('PATCH /quotations/[id]/status (integración local)', () => {
  test('cambiar estado regenera approval_token y preserva is_approved de los ítems', async () => {
    const { id, token, itemIds } = await seedQuotation({
      status: 'draft',
      items: [{ etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 1, is_approved: true }],
    })

    const res = await patchStatus(id, 'sent_for_approval')
    expect(res.status).toBe(200)

    const [q] = await sql<{ approval_token: string; status: string }>(
      'SELECT approval_token, status FROM quotations WHERE id = $1', [id],
    )
    expect(q.status).toBe('sent_for_approval')
    expect(q.approval_token).not.toBe(token) // token regenerado → link viejo muere

    const [item] = await sql<{ is_approved: boolean | null }>(
      'SELECT is_approved FROM quotation_items WHERE id = $1', [itemIds[0]],
    )
    expect(item.is_approved).toBe(true) // decisión preservada
  })

  test('approved sella approved_at y lo PRESERVA al re-aprobar (no lo pisa)', async () => {
    const { id } = await seedQuotation({ status: 'sent_for_approval', items: [{ etm: 'A', quantity: 1, unit_price: 1 }] })

    expect((await patchStatus(id, 'approved')).status).toBe(200)
    const [first] = await sql<{ approved_at: string | null }>('SELECT approved_at FROM quotations WHERE id = $1', [id])
    expect(first.approved_at).not.toBeNull()

    // Regresar a draft y re-aprobar: approved_at debe conservar la fecha ORIGINAL.
    await patchStatus(id, 'draft')
    await patchStatus(id, 'approved')
    const [second] = await sql<{ approved_at: Date }>('SELECT approved_at FROM quotations WHERE id = $1', [id])
    // pg devuelve Date: comparar por valor (mismo instante = fecha original conservada).
    expect(new Date(second.approved_at).getTime()).toBe(new Date(first.approved_at!).getTime())
  })

  test('no se puede reabrir una cotización convertida con orden vinculada (400)', async () => {
    const { id } = await seedQuotation({ status: 'converted_to_order', items: [{ etm: 'A', quantity: 1, unit_price: 1 }] })
    // Orden vinculada.
    await sql("INSERT INTO orders (name, customer_name, status, total_amount, quotation_id) VALUES ('O','ACME','ordered',0,$1)", [id])

    const res = await patchStatus(id, 'draft')
    expect(res.status).toBe(400)
    const body = await readJson<{ message: string }>(res)
    expect(body.message).toMatch(/orden vinculada/i)
  })
})
