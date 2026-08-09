/**
 * Módulo de corte (issue #59) — route handlers con Supabase mockeado.
 *   - GET: coerción numeric-string → number (trampa de supabase-js), candidatos
 *     DYMMSA sin separadores, margen desde settings.
 *   - PUT: replace-all con espejo del CHECK de forma (mensajes claros), orden
 *     read-only bloqueada, restauración si el insert falla.
 *   - presentations POST: upsert contra el UNIQUE con last_used_at fresco.
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, filterValue } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeRequest, makeParams } from '../helpers/request'
import * as cutPlanRoute from '@/app/api/orders/[id]/cut-plan/route'
import * as presentationsRoute from '@/app/api/material-presentations/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const ORDER = { id: 'o1', name: 'Orden 1', customer_name: 'ACME', status: 'ordered' }

const getPlan = () =>
  cutPlanRoute.GET(makeRequest(undefined, { method: 'GET' }), makeParams({ id: 'o1' }))
const putPlan = (body: unknown) =>
  cutPlanRoute.PUT(makeRequest(body, { method: 'PUT' }), makeParams({ id: 'o1' }))

const TUBE = { material_type: 'tube', diameter_mm: 30, length_mm: 300, quantity: 4 }

describe('GET /orders/[id]/cut-plan', () => {
  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await getPlan()).status).toBe(401)
  })

  test('404 si la orden no existe', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await getPlan()).status).toBe(404)
  })

  test('coerce los numeric (string de supabase-js) a number y arma candidatos', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: ORDER, error: null },
        'cut_plan_pieces.select': {
          // numeric llega como STRING: la respuesta debe salir en number.
          data: [{ id: 'p1', material_type: 'tube', diameter_mm: '30', thickness_mm: null, width_mm: null, length_mm: '300.5', quantity: 4 }],
          error: null,
        },
        'order_items.select': {
          data: [
            // ' dymmsa ' con basura: la normalización debe ser la MISMA
            // trim+upper que usa el botón de OrderDetail.
            { id: 'i1', etm: 'DY-1', description: 'Botador', quantity_approved: 4, item_type: 'product', brand: ' dymmsa ' },
            { id: 'i2', etm: null, description: 'Proyecto A', quantity_approved: 0, item_type: 'separator', brand: 'DYMMSA' },
            { id: 'i3', etm: 'U-1', description: 'Llave', quantity_approved: 2, item_type: 'product', brand: 'URREA' },
          ],
          error: null,
        },
        'etm_products.select': {
          data: [{ etm: 'DY-1', cut_kind: 'tube', cut_diameter_mm: '30', cut_thickness_mm: null, cut_width_mm: null, cut_length_mm: '300' }],
          error: null,
        },
        'material_presentations.select': {
          data: [{ id: 'm1', material_type: 'tube', diameter_mm: '30', thickness_mm: null, width_mm: null, length_mm: '6000' }],
          error: null,
        },
        'app_settings.select': { data: [{ key: 'cut_margin_mm', value: 15 }], error: null },
      },
    })
    const res = await getPlan()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.pieces[0].diameter_mm).toBe(30)
    expect(body.pieces[0].length_mm).toBe(300.5)
    expect(body.presentations[0].length_mm).toBe(6000)
    expect(body.marginMm).toBe(15)
    // El separador DYMMSA no es candidato; el producto trae el nominal para pre-llenar.
    expect(body.candidates).toHaveLength(1)
    expect(body.candidates[0]).toMatchObject({ itemId: 'i1', etm: 'DY-1', cutKind: 'tube', diameterMm: 30, lengthMm: 300 })
  })

  test('sin fila de margen cae al default (20)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'orders.select': { data: ORDER, error: null },
        'cut_plan_pieces.select': { data: [], error: null },
        'order_items.select': { data: [], error: null },
        'material_presentations.select': { data: [], error: null },
        'app_settings.select': { data: [], error: null },
      },
    })
    const body = await (await getPlan()).json()
    expect(body.marginMm).toBe(20)
  })
})

describe('PUT /orders/[id]/cut-plan', () => {
  const okOrder = { 'orders.select': { data: ORDER, error: null } }

  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await putPlan({ pieces: [] })).status).toBe(401)
  })

  test('orden completada/cancelada → 400', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'orders.select': { data: { ...ORDER, status: 'completed' }, error: null } },
    })
    expect((await putPlan({ pieces: [TUBE] })).status).toBe(400)
  })

  test('espejo del CHECK de forma: mensajes claros por pieza', async () => {
    const cases = [
      { ...TUBE, diameter_mm: null },                    // tubo sin diámetro
      { ...TUBE, width_mm: 100 },                        // tubo con ancho
      { material_type: 'plate', thickness_mm: 5, length_mm: 300, quantity: 1 }, // placa sin ancho
      { ...TUBE, quantity: 1.5 },                        // cantidad no entera
      { ...TUBE, length_mm: 0 },                         // longitud 0
      { ...TUBE, material_type: 'rod' },                 // tipo desconocido
    ]
    for (const piece of cases) {
      activeClient = createMockSupabase({ user: AUTH, responses: okOrder })
      const res = await putPlan({ pieces: [piece] })
      expect(res.status).toBe(400)
    }
  })

  test('replace-all: borra por order_id e inserta con sort_order = índice', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        ...okOrder,
        'cut_plan_pieces.select': { data: [], error: null },
        'cut_plan_pieces.delete': { data: null, error: null },
        'cut_plan_pieces.insert': { data: [{ id: 'n1' }], error: null },
      },
    })
    const res = await putPlan({
      pieces: [
        { ...TUBE, requested_label: '  ' }, // vacío → null
        { material_type: 'plate', thickness_mm: 5, width_mm: 200, length_mm: 300, quantity: 2 },
      ],
    })
    expect(res.status).toBe(200)

    const del = activeClient.callsTo('cut_plan_pieces', 'delete')[0]
    expect(filterValue(del, 'order_id')).toBe('o1')

    const inserted = activeClient.callsTo('cut_plan_pieces', 'insert')[0]
      .payload as Record<string, unknown>[]
    expect(inserted.map((r) => r.sort_order)).toEqual([0, 1])
    expect(inserted[0].requested_label).toBeNull()
    expect(inserted[1]).toMatchObject({ material_type: 'plate', thickness_mm: 5, width_mm: 200, diameter_mm: null })
  })

  test('si el insert falla, RESTAURA la lista previa (no se pierde por un error)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        ...okOrder,
        'cut_plan_pieces.select': {
          data: [{ id: 'old1', order_id: 'o1', material_type: 'tube', diameter_mm: 30, length_mm: 100, quantity: 1 }],
          error: null,
        },
        'cut_plan_pieces.delete': { data: null, error: null },
        'cut_plan_pieces.insert': { data: null, error: { message: 'boom' } },
      },
    })
    const res = await putPlan({ pieces: [TUBE] })
    expect(res.status).toBe(500)

    // Dos inserts: el que falló + la restauración (sin el id viejo).
    const inserts = activeClient.callsTo('cut_plan_pieces', 'insert')
    expect(inserts).toHaveLength(2)
    const restored = inserts[1].payload as Record<string, unknown>[]
    expect(restored[0]).not.toHaveProperty('id')
    expect(restored[0]).toMatchObject({ order_id: 'o1', length_mm: 100 })
  })

  test('lista vacía es válida: deja la orden sin piezas', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        ...okOrder,
        'cut_plan_pieces.select': { data: [], error: null },
        'cut_plan_pieces.delete': { data: null, error: null },
      },
    })
    const res = await putPlan({ pieces: [] })
    expect(res.status).toBe(200)
    expect(activeClient.callsTo('cut_plan_pieces', 'insert')).toHaveLength(0)
  })
})

describe('POST /material-presentations', () => {
  const post = (body: unknown) =>
    presentationsRoute.POST(makeRequest(body, { method: 'POST' }))

  test('401 sin auth', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await post({ material_type: 'tube', diameter_mm: 30, length_mm: 6000 })).status).toBe(401)
  })

  test('validación por tipo: tubo sin diámetro y placa sin ancho → 400', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await post({ material_type: 'tube', length_mm: 6000 })).status).toBe(400)
    activeClient = createMockSupabase({ user: AUTH })
    expect((await post({ material_type: 'plate', thickness_mm: 5, length_mm: 3000 })).status).toBe(400)
  })

  test('upsert normaliza los campos del tipo contrario a null y refresca last_used_at', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'material_presentations.upsert': { data: { id: 'm1' }, error: null } },
    })
    const res = await post({ material_type: 'tube', diameter_mm: 30, thickness_mm: 99, length_mm: 6000 })
    expect(res.status).toBe(200)
    const payload = activeClient.callsTo('material_presentations', 'upsert')[0]
      .payload as Record<string, unknown>
    expect(payload).toMatchObject({ material_type: 'tube', diameter_mm: 30, thickness_mm: null, width_mm: null, length_mm: 6000 })
    expect(typeof payload.last_used_at).toBe('string')
  })
})
