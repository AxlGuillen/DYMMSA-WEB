/**
 * Quick-cut seeding from a quotation against local Supabase (ADR-021, #71): the
 * select runs on the real schema, which the unit mock only approximates.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import { authedClient } from './helpers/clients'
import { resetDb, sql, seedQuotation, closePool } from './helpers/db'
import * as cutCandidates from '@/app/api/quotations/[id]/cut-candidates/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

beforeAll(async () => { activeClient = await authedClient() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

const getCandidates = (id: string) =>
  cutCandidates.GET(makeRequest(undefined, { method: 'GET' }), makeParams({ id }))

interface CandidatesBody {
  quotation: { id: string; name: string; customer_name: string }
  candidates: Array<{ itemId: string; etm: string; quantity: number; cutKind: string | null; diameterMm: number | null; lengthMm: number | null }>
}

describe('GET /quotations/[id]/cut-candidates (integración local)', () => {
  test('responde 200 con la pieza DYMMSA y deja fuera la URREA', async () => {
    await sql(
      `INSERT INTO etm_products (etm, model_code, brand, cut_kind, cut_diameter_mm, cut_length_mm)
       VALUES ('DY-1', 'DY-1', 'DYMMSA', 'tube', 30, 300)`,
    )
    const { id, itemIds } = await seedQuotation({
      name: 'Obra Corte',
      customer: 'ACME',
      items: [
        { etm: 'DY-1', brand: 'DYMMSA', quantity: 2 },
        { etm: 'U-1', model_code: '60001', brand: 'URREA', quantity: 1 },
      ],
    })

    const res = await getCandidates(id)
    expect(res.status).toBe(200)
    const body = await readJson<CandidatesBody>(res)
    expect(body.quotation).toEqual({ id, name: 'Obra Corte', customer_name: 'ACME' })
    expect(body.candidates).toHaveLength(1)
    expect(body.candidates[0]).toMatchObject({
      itemId: itemIds[0], etm: 'DY-1', quantity: 2, cutKind: 'tube', diameterMm: 30, lengthMm: 300,
    })
  })

  test('404 si la cotización no existe (cero filas, no error de infraestructura)', async () => {
    const res = await getCandidates(crypto.randomUUID())
    expect(res.status).toBe(404)
  })
})
