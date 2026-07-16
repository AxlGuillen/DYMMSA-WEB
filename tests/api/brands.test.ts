/**
 * Submódulo de marcas (issue #21). Regla clave: eliminar una marca EN USO se
 * bloquea (pre-check + FK sin cascade como backstop); nombres SIEMPRE
 * normalizados trim+upper (cruce futuro por valor con marcas de productos).
 */

import { describe, test, expect, vi } from 'vitest'
import {
  createMockSupabase,
  MockSupabaseClient,
  filterValue,
} from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import * as brands from '@/app/api/brands/route'
import * as brandById from '@/app/api/brands/[id]/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

describe('GET /api/brands', () => {
  test('401 sin usuario', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await brands.GET()).status).toBe(401)
  })

  test('lista con conteo de proveedores aplanado', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'brands.select': {
          data: [
            { id: 'b1', name: 'FLUKE', created_at: 'x', supplier_brands: [{ count: 3 }] },
            { id: 'b2', name: 'URREA', created_at: 'x', supplier_brands: [] },
          ],
          error: null,
        },
      },
    })
    const res = await brands.GET()
    expect(res.status).toBe(200)
    const body = await readJson<{ brands: Array<{ name: string; suppliersCount: number }> }>(res)
    expect(body.brands).toEqual([
      expect.objectContaining({ name: 'FLUKE', suppliersCount: 3 }),
      expect.objectContaining({ name: 'URREA', suppliersCount: 0 }),
    ])
  })
})

describe('POST /api/brands', () => {
  test('401 sin usuario; 400 sin nombre (incluye solo espacios)', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await brands.POST(makeRequest({ name: 'X' }))).status).toBe(401)

    activeClient = createMockSupabase({ user: AUTH })
    expect((await brands.POST(makeRequest({ name: '   ' }))).status).toBe(400)
    activeClient = createMockSupabase({ user: AUTH })
    expect((await brands.POST(makeRequest({}))).status).toBe(400)
  })

  test('REGLA: normaliza trim+upper al crear', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'brands.insert': { data: { id: 'b9', name: 'MAKITA' }, error: null } },
    })
    const res = await brands.POST(makeRequest({ name: '  makita ' }))
    expect(res.status).toBe(201)
    expect(activeClient.insertPayload<Record<string, unknown>>('brands')).toEqual({ name: 'MAKITA' })
  })

  test('duplicada (23505) → 400', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'brands.insert': { data: null, error: { code: '23505', message: 'dup' } } },
    })
    expect((await brands.POST(makeRequest({ name: 'URREA' }))).status).toBe(400)
  })
})

describe('PATCH /api/brands/[id]', () => {
  const patch = (body: unknown) =>
    brandById.PATCH(makeRequest(body, { method: 'PATCH' }), makeParams({ id: 'b1' }))

  test('401; 400 vacío; renombra normalizado', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await patch({ name: 'X' })).status).toBe(401)

    activeClient = createMockSupabase({ user: AUTH })
    expect((await patch({ name: ' ' })).status).toBe(400)

    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'brands.update': { data: { id: 'b1' }, error: null } },
    })
    const res = await patch({ name: ' dewalt ' })
    expect(res.status).toBe(200)
    expect(activeClient.updatePayload('brands')).toEqual({ name: 'DEWALT' })
  })

  test('inexistente (PGRST116) → 404; duplicada (23505) → 400', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'brands.update': { data: null, error: { code: 'PGRST116', message: 'no' } } },
    })
    expect((await patch({ name: 'X' })).status).toBe(404)

    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'brands.update': { data: null, error: { code: '23505', message: 'dup' } } },
    })
    expect((await patch({ name: 'URREA' })).status).toBe(400)
  })
})

describe('DELETE /api/brands/[id]', () => {
  const del = () => brandById.DELETE(makeRequest(), makeParams({ id: 'b1' }))

  test('401 sin usuario', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await del()).status).toBe(401)
  })

  test('REGLA: marca EN USO → 400 con conteo y SIN ejecutar el delete', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'supplier_brands.select': { data: null, error: null, count: 2 },
      },
    })
    const res = await del()
    expect(res.status).toBe(400)
    expect((await readJson<{ message: string }>(res)).message).toContain('2 proveedores')
    expect(activeClient.didCall('brands', 'delete')).toBe(false)
  })

  test('marca libre → elimina', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'supplier_brands.select': { data: null, error: null, count: 0 },
        'brands.delete': { data: null, error: null },
      },
    })
    const res = await del()
    expect(res.status).toBe(200)
    expect(filterValue(activeClient.callsTo('brands', 'delete')[0], 'id')).toBe('b1')
  })

  test('backstop: FK 23503 (carrera tras el pre-check) → 400', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'supplier_brands.select': { data: null, error: null, count: 0 },
        'brands.delete': { data: null, error: { code: '23503', message: 'fk violation' } },
      },
    })
    expect((await del()).status).toBe(400)
  })
})
