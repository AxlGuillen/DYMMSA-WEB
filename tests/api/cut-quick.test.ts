/**
 * Corte rápido (issue #71) — routes nuevas con Supabase mockeado:
 *   - GET material-presentations: catálogo completo con coerción numeric→number.
 *   - DELETE material-presentations/[id]: corregir capturas erróneas; 404 si no existe.
 *   - GET quotations/[id]/cut-candidates: siembra del modo rápido desde la
 *     cotización — separadores fuera, is_sold=false fuera, marca trim+upper.
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeRequest, makeParams } from '../helpers/request'
import * as presentationsRoute from '@/app/api/material-presentations/route'
import * as presentationRoute from '@/app/api/material-presentations/[id]/route'
import * as cutCandidatesRoute from '@/app/api/quotations/[id]/cut-candidates/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

describe('GET /material-presentations', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await presentationsRoute.GET()).status).toBe(401)
  })

  test('lista completa con numeric-string coercido a number', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'material_presentations.select': {
          data: [
            { id: 'm1', material_type: 'tube', diameter_mm: '30', thickness_mm: null, width_mm: null, length_mm: '6000' },
            { id: 'm2', material_type: 'plate', diameter_mm: null, thickness_mm: '10', width_mm: '450', length_mm: '400' },
          ],
          error: null,
        },
      },
    })
    const res = await presentationsRoute.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.presentations).toHaveLength(2)
    expect(body.presentations[0]).toMatchObject({ diameter_mm: 30, length_mm: 6000 })
    expect(body.presentations[1]).toMatchObject({ thickness_mm: 10, width_mm: 450, length_mm: 400 })
  })
})

describe('DELETE /material-presentations/[id]', () => {
  const del = () =>
    presentationRoute.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: 'm1' }))

  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await del()).status).toBe(401)
  })

  test('elimina y responde el id', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'material_presentations.delete': { data: [{ id: 'm1' }], error: null } },
    })
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: 'm1' })
  })

  test('404 si la medida no existe (delete sin filas)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'material_presentations.delete': { data: [], error: null } },
    })
    expect((await del()).status).toBe(404)
  })
})

describe('GET /quotations/[id]/cut-candidates', () => {
  const get = () =>
    cutCandidatesRoute.GET(makeRequest(undefined, { method: 'GET' }), makeParams({ id: 'q1' }))

  const QUOTATION = { id: 'q1', quotation_number: 'COT-001', customer_name: 'ACME' }

  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await get()).status).toBe(401)
  })

  test('404 si la cotización no existe', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await get()).status).toBe(404)
  })

  test('filtra: separadores fuera, is_sold=false fuera, marca trim+upper; nominal pre-llena', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: QUOTATION, error: null },
        'quotation_items.select': {
          data: [
            // ' dymmsa ' con basura: misma normalización que el botón del detalle.
            { id: 'i1', etm: 'DY-1', description: 'Botador', quantity: 4, item_type: 'product', brand: ' dymmsa ', is_sold: null },
            // "No lo vendemos" no se manda a hacer.
            { id: 'i2', etm: 'DY-2', description: 'Punta', quantity: 2, item_type: 'product', brand: 'DYMMSA', is_sold: false },
            { id: 'i3', etm: null, description: 'Proyecto A', quantity: 0, item_type: 'separator', brand: 'DYMMSA', is_sold: null },
            { id: 'i4', etm: 'U-1', description: 'Llave', quantity: 2, item_type: 'product', brand: 'URREA', is_sold: true },
          ],
          error: null,
        },
        'etm_products.select': {
          data: [{ etm: 'DY-1', cut_kind: 'tube', cut_diameter_mm: '30', cut_thickness_mm: null, cut_width_mm: null, cut_length_mm: '300' }],
          error: null,
        },
      },
    })
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quotation).toMatchObject({ id: 'q1', quotation_number: 'COT-001' })
    expect(body.candidates).toHaveLength(1)
    // numeric-string del nominal coercido a number (misma trampa de supabase-js).
    expect(body.candidates[0]).toMatchObject({
      itemId: 'i1', etm: 'DY-1', quantity: 4, cutKind: 'tube', diameterMm: 30, lengthMm: 300,
    })
  })

  test('ítem DYMMSA sin nominal sale con cutKind null (el usuario decide tubo/placa)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: QUOTATION, error: null },
        'quotation_items.select': {
          data: [{ id: 'i1', etm: 'DY-9', description: 'Pieza nueva', quantity: 1, item_type: 'product', brand: 'DYMMSA', is_sold: null }],
          error: null,
        },
        'etm_products.select': { data: [], error: null },
      },
    })
    const body = await (await get()).json()
    expect(body.candidates[0]).toMatchObject({ etm: 'DY-9', cutKind: null, diameterMm: null })
  })
})
