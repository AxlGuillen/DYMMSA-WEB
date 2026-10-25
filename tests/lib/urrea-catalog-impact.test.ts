/** What a catalog change touches (#155 D): saved decisions that go stale and lines that move to URREA. */

import { describe, test, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { catalogChangeImpact, countLinesToOrder, findCatalogRows } from '@/lib/urrea-catalog-store'
import { createMockSupabase, filterValue, hasFilter } from '../helpers/supabase-mock'

const asDb = (mock: ReturnType<typeof createMockSupabase>) => mock as unknown as SupabaseClient

describe('catalogChangeImpact', () => {
  const decisions = [
    { order_id: 'o1', std_snapshot: 10 },
    { order_id: 'o1', std_snapshot: 10 },
    { order_id: 'o2', std_snapshot: 10 },
    { order_id: 'o3', std_snapshot: 12 },
  ]

  test('con un std nuevo, solo las decisiones con otro std_snapshot quedan desactualizadas, contadas por orden', async () => {
    const db = createMockSupabase({ responses: { 'order_purchase_decisions.select': { data: decisions, error: null } } })
    expect(await catalogChangeImpact(asDb(db), { code: ' 6954 ', brand: 'urrea' }, 12)).toEqual({ staleDecisions: 3, orders: 2 })
    const call = db.callsTo('order_purchase_decisions', 'select')[0]
    // The key is normalized and only orders in planning count.
    expect(filterValue(call, 'model_code')).toBe('6954')
    expect(filterValue(call, 'brand')).toBe('URREA')
    expect(call.filters.find((f) => f.method === 'in')?.args).toEqual(['orders.status', ['ordered', 'received']])
  })

  test('sin std (la fila sale del catálogo bajo esa clave) todas quedan desactualizadas', async () => {
    const db = createMockSupabase({ responses: { 'order_purchase_decisions.select': { data: decisions, error: null } } })
    expect(await catalogChangeImpact(asDb(db), { code: '6954', brand: 'URREA' }, null)).toEqual({ staleDecisions: 4, orders: 3 })
  })

  test('un fallo de lectura es 500 con mensaje en español', async () => {
    const db = createMockSupabase({ responses: { 'order_purchase_decisions.select': { data: null, error: { message: 'boom' } } } })
    await expect(catalogChangeImpact(asDb(db), { code: '6954', brand: 'URREA' }, 5)).rejects.toMatchObject({ status: 500 })
  })
})

describe('countLinesToOrder', () => {
  test('cuenta por catalogKey: la marca vacía es URREA y el comodín _ de ilike no mete códigos ajenos', async () => {
    const db = createMockSupabase({
      responses: {
        'order_items.select': {
          data: [
            { order_id: 'o1', model_code: 'AB_1', brand: '' },
            { order_id: 'o1', model_code: 'ab_1', brand: 'urrea' },
            { order_id: 'o2', model_code: 'ABX1', brand: '' },
            { order_id: 'o3', model_code: 'AB_1', brand: 'SURTEK' },
          ],
          error: null,
        },
      },
    })
    expect(await countLinesToOrder(asDb(db), { code: 'ab_1', brand: 'URREA' })).toEqual({ lines: 2, orders: 1 })
    const call = db.callsTo('order_items', 'select')[0]
    expect(hasFilter(call, 'item_type')).toBe(true)
    expect(hasFilter(call, 'quantity_to_order', 'gt')).toBe(true)
  })
})

describe('findCatalogRows', () => {
  test('busca por el código normalizado, todas las marcas', async () => {
    const db = createMockSupabase({ responses: { 'urrea_catalog.select': { data: [{ code: 'X1', brand: 'FOY' }], error: null } } })
    expect(await findCatalogRows(asDb(db), ' x1 ')).toEqual([{ code: 'X1', brand: 'FOY' }])
    expect(filterValue(db.callsTo('urrea_catalog', 'select')[0], 'code')).toBe('X1')
  })
})
