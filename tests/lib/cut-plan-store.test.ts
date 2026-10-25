/** parseCutPieces and cut-plan-store (#155 D): the route's rules, the origin-line check and the restore on a failed insert. */

import { describe, test, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCutPieces } from '@/lib/cut-plan'
import { CutPlanError, loadCutPieces, saveCutPlan } from '@/lib/cut-plan-store'
import { createMockSupabase, type CallRecord } from '../helpers/supabase-mock'

const asDb = (mock: ReturnType<typeof createMockSupabase>) => mock as unknown as SupabaseClient
const ORDER = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const tube = (over: Record<string, unknown> = {}) => ({ material_type: 'tube', diameter_mm: 25.4, length_mm: 300, quantity: 4, ...over })
const plate = (over: Record<string, unknown> = {}) => ({ material_type: 'plate', thickness_mm: 6, width_mm: 200, length_mm: 400, quantity: 2, ...over })

const errorOf = (pieces: unknown) => {
  const parsed = parseCutPieces(pieces)
  return 'error' in parsed ? parsed.error : null
}

describe('parseCutPieces', () => {
  test('arma las filas con sort_order por posición, recorta la etiqueta y anula lo que la forma no usa', () => {
    const parsed = parseCutPieces([tube({ requested_label: '  punta 30/300  ' }), plate({ source_item_id: ITEM })])
    expect(parsed).toEqual({
      value: [
        { material_type: 'tube', diameter_mm: 25.4, thickness_mm: null, width_mm: null, length_mm: 300, quantity: 4, requested_label: 'punta 30/300', source_item_id: null, sort_order: 0 },
        { material_type: 'plate', diameter_mm: null, thickness_mm: 6, width_mm: 200, length_mm: 400, quantity: 2, requested_label: null, source_item_id: ITEM, sort_order: 1 },
      ],
    })
  })

  test.each([
    [[{ material_type: 'barra' }], 'Pieza 1: tipo de material inválido'],
    [[tube({ length_mm: 0 })], 'Pieza 1: la longitud debe ser mayor a 0'],
    [[tube({ quantity: 1.5 })], 'Pieza 1: la cantidad debe ser un entero mayor a 0'],
    [[tube({ diameter_mm: null })], 'Pieza 1: un tubo necesita diámetro'],
    [[tube({ width_mm: 5 })], 'Pieza 1: un tubo no lleva ancho ni espesor'],
    [[tube(), plate({ width_mm: null })], 'Pieza 2: una placa necesita espesor y ancho'],
    [[plate({ diameter_mm: 3 })], 'Pieza 1: una placa no lleva diámetro'],
    [{}, 'El body debe incluir un array "pieces"'],
  ])('REGLA: %j → «%s»', (pieces, message) => {
    expect(errorOf(pieces)).toBe(message)
  })

  test('una lista vacía es válida (vaciar la lista)', () => {
    expect(parseCutPieces([])).toEqual({ value: [] })
  })
})

function db(over: Record<string, unknown> = {}) {
  return createMockSupabase({
    responses: {
      'orders.select': { data: { id: ORDER, status: 'ordered' }, error: null },
      'cut_plan_pieces.select': { data: [{ id: 'p1', order_id: ORDER, material_type: 'tube', diameter_mm: '25.4', length_mm: '300', quantity: 1, sort_order: 0 }], error: null },
      'cut_plan_pieces.insert': (rec: CallRecord) => ({ data: rec.payload, error: null }),
      'order_items.select': { data: [{ id: ITEM }], error: null },
      ...over,
    },
  })
}

describe('saveCutPlan', () => {
  test('una orden que no existe es 404; completada o cancelada, 400; nada se toca', async () => {
    const missing = createMockSupabase({ responses: { 'orders.select': { data: null, error: null } } })
    await expect(saveCutPlan(asDb(missing), ORDER, [])).rejects.toMatchObject({ status: 404 })
    const closed = db({ 'orders.select': { data: { id: ORDER, status: 'cancelled' }, error: null } })
    await expect(saveCutPlan(asDb(closed), ORDER, [tube()])).rejects.toThrow('No se puede modificar una orden completada o cancelada')
    expect(closed.callsTo('cut_plan_pieces', 'delete')).toEqual([])
  })

  test('REGLA: la línea de origen tiene que ser de la orden, y se revisa antes de borrar nada', async () => {
    const foreign = db({ 'order_items.select': { data: [], error: null } })
    await expect(saveCutPlan(asDb(foreign), ORDER, [tube(), plate({ source_item_id: ITEM })])).rejects.toThrow('Pieza 2: la línea de origen no es de esta orden')
    expect(foreign.callsTo('cut_plan_pieces', 'delete')).toEqual([])
    const own = db()
    await saveCutPlan(asDb(own), ORDER, [plate({ source_item_id: ITEM })])
    expect(own.callsTo('order_items', 'select')[0].filters.find((f) => f.method === 'in')?.args).toEqual(['id', [ITEM]])
  })

  test('sin línea de origen no consulta order_items; una lista vacía borra y no inserta', async () => {
    const plain = db()
    expect(await saveCutPlan(asDb(plain), ORDER, [tube()])).toHaveLength(1)
    expect(plain.didCall('order_items', 'select')).toBe(false)
    const empty = db()
    expect(await saveCutPlan(asDb(empty), ORDER, [])).toEqual([])
    expect(empty.didCall('cut_plan_pieces', 'insert')).toBe(false)
    expect(empty.didCall('cut_plan_pieces', 'delete')).toBe(true)
  })

  test('si el insert falla, vuelve la lista anterior sin ids y el error explica la regla (400); un fallo de otro tipo es 500', async () => {
    let attempts = 0
    const violation = db({ 'cut_plan_pieces.insert': (rec: CallRecord) => (++attempts === 1 ? { data: null, error: { code: '23514', message: 'cut_piece_shape' } } : { data: rec.payload, error: null }) })
    await expect(saveCutPlan(asDb(violation), ORDER, [tube()])).rejects.toBeInstanceOf(CutPlanError)
    const writes = violation.callsTo('cut_plan_pieces', 'insert')
    expect(writes).toHaveLength(2)
    expect(writes[1].payload).toEqual([{ order_id: ORDER, material_type: 'tube', diameter_mm: '25.4', length_mm: '300', quantity: 1, sort_order: 0 }])

    const broken = db({ 'cut_plan_pieces.insert': { data: null, error: { message: 'boom' } } })
    await expect(saveCutPlan(asDb(broken), ORDER, [tube()])).rejects.toMatchObject({ status: 500, message: 'Error al guardar la lista de corte' })
  })
})

describe('loadCutPieces', () => {
  test('las piezas en orden de la lista; un fallo de lectura es 500', async () => {
    const ok = db()
    expect(await loadCutPieces(asDb(ok), ORDER)).toHaveLength(1)
    expect(ok.callsTo('cut_plan_pieces', 'select')[0].filters.find((f) => f.method === 'order')?.args).toEqual(['sort_order', { ascending: true }])
    const broken = db({ 'cut_plan_pieces.select': { data: null, error: { message: 'boom' } } })
    await expect(loadCutPieces(asDb(broken), ORDER)).rejects.toMatchObject({ status: 500 })
  })
})
