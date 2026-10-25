/** MCP inventory tools. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, hasFilter, filterValue } from '../helpers/supabase-mock'
import { ToolError } from '@/lib/mcp/core/errors'
import type { CallRecord } from '../helpers/supabase-mock'
import { searchInventory, getInventoryStats, planSaveInventoryItem, commitSaveInventoryItem } from '@/lib/mcp/tools/inventory'
import type { Db } from '@/lib/mcp/core/db'
import { InventoryError, setInventoryLocation } from '@/lib/inventory-store'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

describe('searchInventory', () => {
  test('oculta la ubicación cuando quantity=0 (regla del frontend)', async () => {
    const client = createMockSupabase({
      responses: {
        store_inventory: {
          data: [
            { model_code: 'A1', quantity: 10, location: 'G-1', updated_at: '' },
            { model_code: 'B2', quantity: 0, location: 'G-2', updated_at: '' },
          ],
          count: 2,
        },
      },
    })

    const result = await searchInventory(asDb(client), {})

    expect(result.articulos[0].ubicacion).toBe('G-1')
    expect(result.articulos[1].ubicacion).toBeNull() // kept in the DB, hidden without stock
  })

  test('aplica stockFilter low_stock (gt 0, lte 5)', async () => {
    const client = createMockSupabase({ responses: { store_inventory: { data: [], count: 0 } } })

    await searchInventory(asDb(client), { existencias: 'poca' })

    const call = client.callsTo('store_inventory', 'select')[0]
    expect(hasFilter(call, 'quantity', 'gt')).toBe(true)
    expect(hasFilter(call, 'quantity', 'lte')).toBe(true)
  })

  test('with_stock es la misma lista que la pantalla (gt 0, sin tope), y un filtro inventado es error (#155 C1)', async () => {
    const client = createMockSupabase({ responses: { store_inventory: { data: [], count: 0 } } })
    await searchInventory(asDb(client), { existencias: 'con_existencia' })
    const call = client.callsTo('store_inventory', 'select')[0]
    expect(filterValue(call, 'quantity', 'gt')).toBe(0)
    expect(hasFilter(call, 'quantity', 'lte')).toBe(false)

    const other = createMockSupabase({ responses: { store_inventory: { data: [], count: 0 } } })
    await expect(searchInventory(asDb(other), { existencias: 'agotado' })).rejects.toThrow(/Filtro inválido "agotado": usa todas \| con_existencia/)
    expect(other.callsTo('store_inventory')).toEqual([])
  })
})

describe('getInventoryStats', () => {
  test('clasifica por niveles de stock', async () => {
    const client = createMockSupabase({
      responses: {
        store_inventory: { data: [{ quantity: 0 }, { quantity: 3 }, { quantity: 5 }, { quantity: 9 }] },
      },
    })
    const stats = await getInventoryStats(asDb(client))
    expect(stats).toEqual({ total: 4, sin_existencia: 1, poca: 2, suficiente: 1 })
  })
})

describe('save_inventory_item (issue #72, #155 C6): solo la gaveta', () => {
  const row = (model_code: string, quantity: number, location: string | null) => ({ model_code, quantity, location })
  /** select = the plan's read, update = the write; keyed as the mock wants. */
  const client = (stored: ReturnType<typeof row>[], written: (rec: CallRecord) => { data: unknown; error: unknown } = () => ({ data: stored.slice(0, 1), error: null })) =>
    createMockSupabase({ responses: { 'store_inventory.select': (rec: CallRecord) => ({ data: stored.filter((r) => r.model_code.toLowerCase() === String(filterValue(rec, 'model_code', 'ilike')).toLowerCase().replace(/\\/g, '')), error: null }), 'store_inventory.update': written } })

  const save = async (db: ReturnType<typeof createMockSupabase>, productos: { codigo: string; ubicacion: string }[]) =>
    commitSaveInventoryItem(asDb(db), await planSaveInventoryItem(asDb(db), { productos }))

  test('recorta el código, matchea sin distinguir mayúsculas y solo actualiza location; devuelve antes y ahora', async () => {
    const c = client([row('6954', 12, null)], () => ({ data: [row('6954', 12, 'Gaveta B3')], error: null }))
    const result = await save(c, [{ codigo: ' 6954 ', ubicacion: '  Gaveta B3  ' }])

    // The update payload carries ONLY location — quantities are untouchable.
    expect(c.updatePayload('store_inventory')).toEqual({ location: 'Gaveta B3' })
    expect(filterValue(c.callsTo('store_inventory', 'update')[0], 'model_code', 'eq')).toBe('6954')
    expect(result).toMatchObject({ accion: 'actualizado', escrito: true, productos: [{ codigo: '6954', cantidad: 12, ubicacion: 'Gaveta B3' }] })
    expect(result.cambios).toEqual({ 'ubicacion 6954': { antes: null, ahora: 'Gaveta B3' } })
  })

  test('encuentra códigos almacenados en minúsculas y escapa los comodines del ilike', async () => {
    const lower = client([row('abc-123x', 3, 'A0')], () => ({ data: [row('abc-123x', 3, 'Gaveta A1')], error: null }))
    const result = await save(lower, [{ codigo: 'ABC-123X', ubicacion: 'Gaveta A1' }])
    expect(result.productos[0]).toMatchObject({ codigo: 'abc-123x', ubicacion: 'Gaveta A1' })

    const wild = client([])
    await expect(save(wild, [{ codigo: '50%_A', ubicacion: 'X' }])).rejects.toThrow(/no está en el inventario/)
    expect(filterValue(wild.callsTo('store_inventory', 'select')[0], 'model_code', 'ilike')).toBe('50\\%\\_A')
    expect(wild.callsTo('store_inventory', 'update')).toEqual([])
  })

  test('ubicacion vacía borra la gaveta (null) y lo dice', async () => {
    const c = client([row('X1', 3, 'G-2')], () => ({ data: [row('X1', 3, null)], error: null }))
    const result = await save(c, [{ codigo: 'x1', ubicacion: '   ' }])
    expect(c.updatePayload('store_inventory')).toEqual({ location: null })
    expect(result.nota).toMatch(/borra la gaveta/)
    expect(result.cambios).toEqual({ 'ubicacion X1': { antes: 'G-2', ahora: null } })
  })

  test('un código que no existe frena TODA la llamada antes de escribir, y los nombra', async () => {
    const c = client([row('6954', 12, null)])
    await expect(save(c, [{ codigo: '6954', ubicacion: 'B3' }, { codigo: 'NOEXISTE', ubicacion: 'G-9' }, { codigo: 'OTRO', ubicacion: 'G-1' }])).rejects.toThrow(
      /"NOEXISTE", "OTRO" no están en el inventario/,
    )
    expect(c.callsTo('store_inventory', 'update')).toEqual([])
  })

  test('el ilike que toca >1 fila (abc y ABC) avisa en vez de escribir; un código repetido en la llamada también', async () => {
    const clash = client([row('abc', 1, 'A1'), row('ABC', 2, 'A1')])
    await expect(save(clash, [{ codigo: 'abc', ubicacion: 'A1' }])).rejects.toThrow(/coincide con varios códigos/)
    expect(clash.callsTo('store_inventory', 'update')).toEqual([])
    await expect(save(client([row('6954', 1, null)]), [{ codigo: '6954', ubicacion: 'A' }, { codigo: '6954 ', ubicacion: 'B' }])).rejects.toThrow(/aparece dos veces/)
  })

  test('setInventoryLocation revisa antes de escribir: una colisión por mayúsculas es conflicto y no toca ninguna fila', async () => {
    const clash = client([row('abc', 1, 'A1'), row('ABC', 2, 'A1')])
    const error = await setInventoryLocation(asDb(clash), 'abc', 'B2').catch((e) => e)
    expect(error).toBeInstanceOf(InventoryError)
    expect(error).toMatchObject({ kind: 'conflict' })
    expect(clash.callsTo('store_inventory', 'update')).toEqual([])

    const missing = client([])
    await expect(setInventoryLocation(asDb(missing), 'NOEXISTE', 'B2')).rejects.toMatchObject({ kind: 'not_found' })
    expect(missing.callsTo('store_inventory', 'update')).toEqual([])

    const one = client([row('abc', 3, 'A1')], () => ({ data: [row('abc', 3, 'B2')], error: null }))
    await expect(setInventoryLocation(asDb(one), 'ABC', 'B2')).resolves.toMatchObject({ model_code: 'abc', location: 'B2' })
    expect(hasFilter(one.callsTo('store_inventory', 'update')[0], 'model_code', 'eq')).toBe(true)
  })

  test('varios productos: uno por uno; si falla el segundo dice qué sí quedó guardado', async () => {
    let calls = 0
    const c = client([row('A1', 1, null), row('B2', 2, null)], (rec) => {
      calls += 1
      const code = String(filterValue(rec, 'model_code', 'eq'))
      return calls === 1 ? { data: [row(code, 1, 'G-1')], error: null } : { data: null, error: { message: 'boom' } }
    })
    const error = await save(c, [{ codigo: 'A1', ubicacion: 'G-1' }, { codigo: 'B2', ubicacion: 'G-2' }]).catch((e) => e)
    expect(error).toBeInstanceOf(ToolError)
    expect(error.message).toBe('Se guardó la ubicación de A1, pero falló en B2: Error al actualizar la ubicación. Repite solo lo que falta.')
  })

  test('sin código → error sin tocar la BD', async () => {
    const c = createMockSupabase({ responses: {} })
    await expect(planSaveInventoryItem(asDb(c), { productos: [{ codigo: '  ', ubicacion: 'G-1' }] })).rejects.toThrow(ToolError)
    expect(c._calls).toEqual([])
  })
})

