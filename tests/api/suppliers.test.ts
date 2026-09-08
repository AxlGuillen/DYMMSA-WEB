/** Suppliers (#21): the parent is rolled back if the links fail, and PATCH
 *  replaces brands by DIFF instead of wiping them. */

import { describe, test, expect, vi } from 'vitest'
import {
  createMockSupabase,
  MockSupabaseClient,
  hasFilter,
  filterValue,
} from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import * as suppliers from '@/app/api/suppliers/route'
import * as supplierById from '@/app/api/suppliers/[id]/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const SUPPLIER_ROW = {
  id: 's1',
  name: 'Ferretería El Tornillo',
  phone: '4431112222',
  whatsapp: '4433334444',
  email: 'ventas@tornillo.mx',
  address: 'Av. Madero 123',
  notes: null,
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-07-16T00:00:00Z',
}

describe('GET /api/suppliers', () => {
  test('401 sin usuario', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await suppliers.GET(makeRequest(undefined, { url: 'http://x/api/suppliers' }))).status).toBe(401)
  })

  test('lista paginada con marcas aplanadas y ordenadas', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'suppliers.select': {
          data: [{
            ...SUPPLIER_ROW,
            supplier_brands: [
              { brands: { id: 'b2', name: 'URREA', created_at: 'x' } },
              { brands: { id: 'b1', name: 'FLUKE', created_at: 'x' } },
              { brands: null }, // defensive orphan link
            ],
          }],
          error: null,
          count: 1,
        },
      },
    })
    const res = await suppliers.GET(makeRequest(undefined, { url: 'http://x/api/suppliers?page=1' }))
    expect(res.status).toBe(200)
    const body = await readJson<{ data: Array<{ name: string; brands: Array<{ name: string }> }>; count: number; totalPages: number }>(res)
    expect(body.count).toBe(1)
    expect(body.data[0].name).toBe('Ferretería El Tornillo')
    // flattened, no nulls, alphabetical
    expect(body.data[0].brands.map((b) => b.name)).toEqual(['FLUKE', 'URREA'])
  })

  test('search aplica .or() sobre name/phone/whatsapp/email', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'suppliers.select': { data: [], error: null, count: 0 } },
    })
    await suppliers.GET(makeRequest(undefined, { url: 'http://x/api/suppliers?search=tornillo' }))
    const call = activeClient.callsTo('suppliers', 'select')[0]
    const orFilter = call.filters.find((f) => f.method === 'or')
    expect(orFilter?.args[0]).toContain('name.ilike.%tornillo%')
    expect(orFilter?.args[0]).toContain('whatsapp.ilike.%tornillo%')
  })

  test('filtro brandId: consulta links primero y filtra por ids', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'supplier_brands.select': { data: [{ supplier_id: 's1' }], error: null },
        'suppliers.select': { data: [{ ...SUPPLIER_ROW, supplier_brands: [] }], error: null, count: 1 },
      },
    })
    await suppliers.GET(makeRequest(undefined, { url: 'http://x/api/suppliers?brandId=b1' }))
    const linksCall = activeClient.callsTo('supplier_brands', 'select')[0]
    expect(filterValue(linksCall, 'brand_id')).toBe('b1')
    const suppliersCall = activeClient.callsTo('suppliers', 'select')[0]
    expect(filterValue(suppliersCall, 'id', 'in')).toEqual(['s1'])
  })

  test('filtro brandId sin proveedores → lista vacía sin consultar suppliers', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'supplier_brands.select': { data: [], error: null } },
    })
    const res = await suppliers.GET(makeRequest(undefined, { url: 'http://x/api/suppliers?brandId=b1' }))
    const body = await readJson<{ data: unknown[]; count: number }>(res)
    expect(body.data).toEqual([])
    expect(activeClient.didCall('suppliers', 'select')).toBe(false)
  })
})

describe('POST /api/suppliers', () => {
  test('401 sin usuario; 400 sin nombre', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await suppliers.POST(makeRequest({ name: 'X' }))).status).toBe(401)

    activeClient = createMockSupabase({ user: AUTH })
    expect((await suppliers.POST(makeRequest({ name: '   ' }))).status).toBe(400)
  })

  test('crea proveedor con links de marcas', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'suppliers.insert': { data: { ...SUPPLIER_ROW }, error: null },
        'supplier_brands.insert': { data: null, error: null },
      },
    })
    const res = await suppliers.POST(makeRequest({
      name: '  Ferretería El Tornillo  ',
      whatsapp: '4433334444',
      email: 'ventas@tornillo.mx',
      brandIds: ['b1', 'b2', 'b1'], // duplicate is de-duplicated
    }))
    expect(res.status).toBe(201)

    const payload = activeClient.insertPayload<Record<string, unknown>>('suppliers')
    expect(payload.name).toBe('Ferretería El Tornillo') // trim
    const links = activeClient.insertPayload('supplier_brands')
    expect(links).toEqual([
      { supplier_id: 's1', brand_id: 'b1' },
      { supplier_id: 's1', brand_id: 'b2' },
    ])
  })

  test('payment_terms_days (issue #84): persiste el entero, null = contado, rechaza basura', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'suppliers.insert': { data: { ...SUPPLIER_ROW }, error: null } },
    })
    await suppliers.POST(makeRequest({ name: 'Con Crédito', payment_terms_days: 30 }))
    expect(activeClient.insertPayload<Record<string, unknown>>('suppliers').payment_terms_days).toBe(30)

    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'suppliers.insert': { data: { ...SUPPLIER_ROW }, error: null } },
    })
    await suppliers.POST(makeRequest({ name: 'De Contado' }))
    expect(activeClient.insertPayload<Record<string, unknown>>('suppliers').payment_terms_days).toBeNull()

    activeClient = createMockSupabase({ user: AUTH })
    expect((await suppliers.POST(makeRequest({ name: 'X', payment_terms_days: -5 }))).status).toBe(400)
    expect((await suppliers.POST(makeRequest({ name: 'X', payment_terms_days: 2.5 }))).status).toBe(400)
  })

  test('REGLA: rollback — si fallan los links se elimina el proveedor', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'suppliers.insert': { data: { ...SUPPLIER_ROW }, error: null },
        'supplier_brands.insert': { data: null, error: { message: 'fail' } },
        'suppliers.delete': { data: null, error: null },
      },
    })
    const res = await suppliers.POST(makeRequest({ name: 'X', brandIds: ['b1'] }))
    expect(res.status).toBe(500)
    const deleteCall = activeClient.callsTo('suppliers', 'delete')[0]
    expect(filterValue(deleteCall, 'id')).toBe('s1')
  })

  test('nombre duplicado (23505) → 400', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'suppliers.insert': { data: null, error: { code: '23505', message: 'duplicate' } },
      },
    })
    expect((await suppliers.POST(makeRequest({ name: 'Repetido' }))).status).toBe(400)
  })
})

describe('PATCH /api/suppliers/[id]', () => {
  const patch = (body: unknown) =>
    supplierById.PATCH(makeRequest(body, { method: 'PATCH' }), makeParams({ id: 's1' }))

  test('401 sin usuario; 400 sin cambios; 400 nombre vacío', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await patch({ name: 'X' })).status).toBe(401)

    activeClient = createMockSupabase({ user: AUTH })
    expect((await patch({})).status).toBe(400)

    activeClient = createMockSupabase({ user: AUTH })
    expect((await patch({ name: '  ' })).status).toBe(400)
  })

  test('updates sparse: solo los campos enviados', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'suppliers.update': { data: { id: 's1' }, error: null } },
    })
    const res = await patch({ phone: ' 443999 ', notes: '' })
    expect(res.status).toBe(200)
    const upd = activeClient.updatePayload('suppliers')
    expect(upd).toEqual({ phone: '443999', notes: null }) // trim + empty → null
  })

  test('REGLA: brandIds hace replace por DIFF (inserta nuevas, borra removidas)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'suppliers.select': { data: { id: 's1' }, error: null }, // existence check
        // existing: b1, b2 — wanted: b2, b3 → insert b3, delete b1
        'supplier_brands.select': { data: [{ brand_id: 'b1' }, { brand_id: 'b2' }], error: null },
        'supplier_brands.insert': { data: null, error: null },
        'supplier_brands.delete': { data: null, error: null },
      },
    })
    const res = await patch({ brandIds: ['b2', 'b3'] })
    expect(res.status).toBe(200)

    expect(activeClient.insertPayload('supplier_brands')).toEqual([
      { supplier_id: 's1', brand_id: 'b3' },
    ])
    const deleteCall = activeClient.callsTo('supplier_brands', 'delete')[0]
    expect(filterValue(deleteCall, 'supplier_id')).toBe('s1')
    expect(filterValue(deleteCall, 'brand_id', 'in')).toEqual(['b1'])
  })

  test('brandIds sin cambios → ni inserta ni borra', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'suppliers.select': { data: { id: 's1' }, error: null },
        'supplier_brands.select': { data: [{ brand_id: 'b1' }], error: null },
      },
    })
    const res = await patch({ brandIds: ['b1'] })
    expect(res.status).toBe(200)
    expect(activeClient.didCall('supplier_brands', 'insert')).toBe(false)
    expect(activeClient.didCall('supplier_brands', 'delete')).toBe(false)
  })

  test('proveedor inexistente (PGRST116) → 404', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'suppliers.update': { data: null, error: { code: 'PGRST116', message: 'no rows' } },
      },
    })
    expect((await patch({ name: 'Nuevo' })).status).toBe(404)
  })

  test('solo brandIds con proveedor inexistente → 404 (no 500)', async () => {
    // With no fields to update nothing triggers PGRST116; the existence check
    // before the brand diff is what returns the precise 404.
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'suppliers.select': { data: null, error: { code: 'PGRST116', message: 'no rows' } },
      },
    })
    const res = await patch({ brandIds: ['b1'] })
    expect(res.status).toBe(404)
    expect(activeClient.didCall('supplier_brands', 'insert')).toBe(false)
  })
})

describe('DELETE /api/suppliers/[id]', () => {
  test('401 sin usuario; elimina por id', async () => {
    activeClient = createMockSupabase({ user: null })
    expect(
      (await supplierById.DELETE(makeRequest(), makeParams({ id: 's1' }))).status,
    ).toBe(401)

    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'suppliers.delete': { data: null, error: null } },
    })
    const res = await supplierById.DELETE(makeRequest(), makeParams({ id: 's1' }))
    expect(res.status).toBe(200)
    expect(filterValue(activeClient.callsTo('suppliers', 'delete')[0], 'id')).toBe('s1')
  })
})

describe('sanidad de filtros', () => {
  test('search con caracteres de sintaxis PostgREST se sanitiza', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'suppliers.select': { data: [], error: null, count: 0 } },
    })
    await suppliers.GET(
      makeRequest(undefined, { url: 'http://x/api/suppliers?search=a%2Cb%28c%29' }),
    )
    const call = activeClient.callsTo('suppliers', 'select')[0]
    const orFilter = call.filters.find((f) => f.method === 'or')
    expect(orFilter?.args[0]).not.toContain(',b(c)')
  })

  test('sortField fuera de whitelist cae a name', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'suppliers.select': { data: [], error: null, count: 0 } },
    })
    await suppliers.GET(makeRequest(undefined, { url: 'http://x/api/suppliers?sortField=evil' }))
    const call = activeClient.callsTo('suppliers', 'select')[0]
    expect(hasFilter(call, 'name', 'order')).toBe(true)
  })
})
