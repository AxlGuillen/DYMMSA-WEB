/**
 * Quotations — read handlers migrados al server side (antes el cliente
 * consultaba Supabase directo). Flujo crítico del programa.
 *   - GET /[id]: embed quotation_items(*), orden sort_order, limit(5000), 404
 *   - GET (list): shape paginado, búsqueda .or, whitelist de status, items_count
 *   - GET /stats: reduce por status
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, findFilter, filterValue } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeRequest, makeParams } from '../helpers/request'
import * as listRoute from '@/app/api/quotations/route'
import * as statsRoute from '@/app/api/quotations/stats/route'
import * as itemRoute from '@/app/api/quotations/[id]/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const url = (qs = '') => ({ url: `http://localhost/api/quotations${qs}`, method: 'GET' })

describe('GET /quotations/[id] (single — flujo crítico)', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await itemRoute.GET(makeRequest(undefined, { method: 'GET' }), makeParams({ id: 'q1' }))
    expect(res.status).toBe(401)
  })

  test('devuelve la cotización con sus ítems, ordenados por sort_order y limit(5000)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': {
          data: { id: 'q1', quotation_items: [{ id: 'i1', sort_order: 0 }] },
          error: null,
        },
      },
    })
    const res = await itemRoute.GET(makeRequest(undefined, { method: 'GET' }), makeParams({ id: 'q1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('q1')
    expect(body.quotation_items).toHaveLength(1)

    const rec = activeClient.callsTo('quotations', 'select')[0]
    expect(filterValue(rec, 'id')).toBe('q1')
    expect(findFilter(rec, 'sort_order', 'order')).toBeTruthy()
    const limit = rec.filters.find((f) => f.method === 'limit')
    expect(limit?.args[0]).toBe(5000)
  })

  test('404 cuando no existe (PGRST116)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'quotations.select': { data: null, error: { code: 'PGRST116' } } },
    })
    const res = await itemRoute.GET(makeRequest(undefined, { method: 'GET' }), makeParams({ id: 'nope' }))
    expect(res.status).toBe(404)
  })
})

describe('GET /quotations (list)', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await listRoute.GET(makeRequest(undefined, url()))
    expect(res.status).toBe(401)
  })

  test('shape paginado + mapeo de items_count', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': {
          data: [
            { id: 'q1', quotation_items: [{ count: 7 }] },
            { id: 'q2', quotation_items: null },
          ],
          error: null,
          count: 2,
        },
      },
    })
    const res = await listRoute.GET(makeRequest(undefined, url('?page=1&pageSize=20')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(2)
    expect(body.totalPages).toBe(1)
    expect(body.data[0].items_count).toBe(7)
    expect(body.data[1].items_count).toBe(0)
    const rec = activeClient.callsTo('quotations', 'select')[0]
    expect(findFilter(rec, 'created_at', 'order')).toBeTruthy()
  })

  test('búsqueda agrega filtro .or', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'quotations.select': { data: [], error: null, count: 0 } },
    })
    await listRoute.GET(makeRequest(undefined, url('?search=acme')))
    const rec = activeClient.callsTo('quotations', 'select')[0]
    const or = rec.filters.find((f) => f.method === 'or')
    expect(or).toBeTruthy()
    expect(String(or!.args[0])).toContain('acme')
  })

  test('status válido agrega filtro eq', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'quotations.select': { data: [], error: null, count: 0 } },
    })
    await listRoute.GET(makeRequest(undefined, url('?status=approved')))
    const rec = activeClient.callsTo('quotations', 'select')[0]
    expect(filterValue(rec, 'status')).toBe('approved')
  })

  test('status inválido NO agrega filtro eq (cae a all)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'quotations.select': { data: [], error: null, count: 0 } },
    })
    await listRoute.GET(makeRequest(undefined, url('?status=DROP')))
    const rec = activeClient.callsTo('quotations', 'select')[0]
    expect(findFilter(rec, 'status')).toBeUndefined()
  })
})

describe('GET /quotations/stats', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await statsRoute.GET()
    expect(res.status).toBe(401)
  })

  test('reduce por status', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': {
          data: [
            { status: 'draft' },
            { status: 'draft' },
            { status: 'approved' },
            { status: 'converted_to_order' },
            { status: 'unknown_ignored' },
          ],
          error: null,
        },
      },
    })
    const res = await statsRoute.GET()
    const body = await res.json()
    expect(body).toMatchObject({
      draft: 2,
      approved: 1,
      converted_to_order: 1,
      sent_for_approval: 0,
      rejected: 0,
    })
  })
})
