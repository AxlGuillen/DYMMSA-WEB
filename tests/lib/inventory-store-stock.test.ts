/** inventory-store (#155 D): what open orders hold, the audited quantity door, and the routes' create / update rules. */

import { describe, test, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { changeStock, createInventoryItem, heldByOpenOrders, InventoryError, updateInventoryItem } from '@/lib/inventory-store'
import { createMockSupabase, filterValue } from '../helpers/supabase-mock'

const asDb = (mock: ReturnType<typeof createMockSupabase>) => mock as unknown as SupabaseClient

describe('heldByOpenOrders', () => {
  test('es computeRestoration de las órdenes pedida / recibida: en stock + min(recibido, pedido), por código, sin secciones', async () => {
    const db = createMockSupabase({
      responses: {
        'order_items.select': {
          data: [
            { model_code: 'A', quantity_in_stock: 3, quantity_received: 2, quantity_to_order: 4, item_type: 'product' },
            { model_code: 'A', quantity_in_stock: 1, quantity_received: 9, quantity_to_order: 2, item_type: 'product' },
            { model_code: 'B', quantity_in_stock: 0, quantity_received: 0, quantity_to_order: 5, item_type: 'product' },
            { model_code: 'C', quantity_in_stock: 7, quantity_received: 0, quantity_to_order: 0, item_type: 'separator' },
          ],
          error: null,
        },
      },
    })
    const held = await heldByOpenOrders(asDb(db), ['A', 'B', 'C'])
    // A: (3 + 2) + (1 + min(9, 2)) = 8; the excess received over the order already entered stock (ADR-019).
    expect([...held]).toEqual([['A', 8]])
    const call = db.callsTo('order_items', 'select')[0]
    expect(call.filters.find((f) => f.method === 'in' && f.args[0] === 'orders.status')?.args[1]).toEqual(['ordered', 'received'])
  })

  test('sin códigos no consulta; un fallo de lectura es 500', async () => {
    const none = createMockSupabase()
    expect((await heldByOpenOrders(asDb(none), [])).size).toBe(0)
    expect(none.callsTo('order_items')).toEqual([])
    const broken = createMockSupabase({ responses: { 'order_items.select': { data: null, error: { message: 'boom' } } } })
    await expect(heldByOpenOrders(asDb(broken), ['A'])).rejects.toMatchObject({ status: 500 })
  })
})

describe('changeStock', () => {
  const rpc = (data: unknown, error: unknown = null) => createMockSupabase({ responses: { 'rpc.change_store_stock': { data, error } } })

  test('manda el modo, el valor, lo esperado (solo en conteo) y el motivo; traduce la respuesta', async () => {
    const counted = rpc({ quantity: 9, changed: true, missing: false })
    expect(await changeStock(asDb(counted), '6954', { mode: 'count', value: 9, expected: 12 }, 'conteo')).toEqual({ quantity: 9, clamped: false, stale: false, missing: false })
    expect(counted.rpcParams('change_store_stock')).toEqual([{ p_model_code: '6954', p_mode: 'count', p_value: 9, p_expected: 12, p_reason: 'conteo' }])

    const delta = rpc({ quantity: 0, clamped: true, missing: false })
    expect(await changeStock(asDb(delta), '6954', { mode: 'delta', value: -9 }, 'rotos')).toMatchObject({ quantity: 0, clamped: true })
    expect(delta.rpcParams('change_store_stock')[0]).toMatchObject({ p_mode: 'delta', p_expected: null })
  })

  test('un conteo que ya no encuentra la cantidad esperada es stale; un código que desapareció es missing', async () => {
    expect(await changeStock(asDb(rpc({ quantity: null, changed: false, missing: false })), 'X', { mode: 'count', value: 1, expected: 2 }, 'r')).toMatchObject({ stale: true, missing: false })
    expect(await changeStock(asDb(rpc({ quantity: null, changed: false, missing: true })), 'X', { mode: 'count', value: 1, expected: 2 }, 'r')).toMatchObject({ stale: false, missing: true })
  })

  test('las reglas de la función (P0001) son 400 en español; cualquier otro fallo es 500', async () => {
    await expect(changeStock(asDb(rpc(null, { code: 'P0001', message: 'reason_required' })), 'X', { mode: 'delta', value: 1 }, ' ')).rejects.toMatchObject({ status: 400, message: 'Todo cambio de cantidad lleva su motivo' })
    await expect(changeStock(asDb(rpc(null, { code: 'P0001', message: 'negative_count' })), 'X', { mode: 'count', value: -1, expected: 0 }, 'r')).rejects.toMatchObject({ status: 400 })
    await expect(changeStock(asDb(rpc(null, { message: 'boom' })), 'X', { mode: 'delta', value: 1 }, 'r')).rejects.toMatchObject({ status: 500, message: 'Error al cambiar la cantidad' })
  })
})

describe('createInventoryItem / updateInventoryItem (las reglas de las rutas)', () => {
  test('el alta recorta el código, trunca la cantidad a 0 o más y vacía la gaveta; sin código es 400; duplicado es 400', async () => {
    const db = createMockSupabase({ responses: { 'store_inventory.insert': { data: { id: 'i' }, error: null } } })
    await createInventoryItem(asDb(db), { model_code: ' 6954 ', quantity: -3.7, location: '  ' })
    expect(db.insertPayload('store_inventory')).toEqual({ model_code: '6954', quantity: 0, location: null })
    await createInventoryItem(asDb(db), { model_code: 'A', quantity: 4.9, location: ' B3 ' })
    expect(db.callsTo('store_inventory', 'insert')[1].payload).toEqual({ model_code: 'A', quantity: 4, location: 'B3' })
    await expect(createInventoryItem(asDb(db), { quantity: 1 })).rejects.toMatchObject({ status: 400, message: 'El código modelo es obligatorio' })
    const clash = createMockSupabase({ responses: { 'store_inventory.insert': { data: null, error: { code: '23505' } } } })
    await expect(createInventoryItem(asDb(clash), { model_code: 'A' })).rejects.toMatchObject({ status: 400, message: 'Ya existe un producto con ese código modelo' })
  })

  test('la edición solo toca lo que viene, la cantidad es absoluta y ≥ 0; sin cambios 400; sin fila 404', async () => {
    const db = createMockSupabase({ responses: { 'store_inventory.update': { data: { id: 'i' }, error: null } } })
    await updateInventoryItem(asDb(db), 'i', { quantity: 7.8, location: '' })
    expect(db.updatePayload('store_inventory')).toEqual({ quantity: 7, location: null })
    expect(filterValue(db.callsTo('store_inventory', 'update')[0], 'id')).toBe('i')
    await expect(updateInventoryItem(asDb(db), 'i', { quantity: -1 })).rejects.toThrow('La cantidad debe ser ≥ 0')
    await expect(updateInventoryItem(asDb(db), 'i', {})).rejects.toThrow('No hay cambios para aplicar')
    await expect(updateInventoryItem(asDb(db), 'i', { model_code: ' ' })).rejects.toBeInstanceOf(InventoryError)
    const none = createMockSupabase({ responses: { 'store_inventory.update': { data: null, error: { code: 'PGRST116' } } } })
    await expect(updateInventoryItem(asDb(none), 'i', { quantity: 1 })).rejects.toMatchObject({ status: 404 })
  })
})
