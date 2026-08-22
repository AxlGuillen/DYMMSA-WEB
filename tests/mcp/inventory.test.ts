/** Tools MCP de inventario. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, hasFilter, filterValue } from '../helpers/supabase-mock'
import { ToolError } from '@/lib/mcp/shared'
import { searchInventory, getInventoryStats, setInventoryLocation } from '@/lib/mcp/tools/inventory'
import { type Db } from '@/lib/mcp/shared'

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

    expect(result.items[0].location).toBe('G-1')
    expect(result.items[1].location).toBeNull() // conservada en BD, oculta sin stock
  })

  test('aplica stockFilter low_stock (gt 0, lte 5)', async () => {
    const client = createMockSupabase({ responses: { store_inventory: { data: [], count: 0 } } })

    await searchInventory(asDb(client), { stockFilter: 'low_stock' })

    const call = client.callsTo('store_inventory', 'select')[0]
    expect(hasFilter(call, 'quantity', 'gt')).toBe(true)
    expect(hasFilter(call, 'quantity', 'lte')).toBe(true)
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
    expect(stats).toEqual({ total: 4, sin_stock: 1, low_stock: 2, in_stock: 1 })
  })
})

describe('setInventoryLocation (issue #72)', () => {
  test('recorta el código, matchea case-insensitive y solo actualiza location', async () => {
    const client = createMockSupabase({
      responses: {
        'store_inventory.update': {
          data: [{ model_code: '6954', quantity: 12, location: 'Gaveta B3' }],
          error: null,
        },
      },
    })

    const result = await setInventoryLocation(asDb(client), { model_code: ' 6954 ', location: '  Gaveta B3  ' })

    // El payload del update SOLO trae location — cantidades intocables.
    expect(client.updatePayload('store_inventory')).toEqual({ location: 'Gaveta B3' })
    const call = client.callsTo('store_inventory', 'update')[0]
    expect(filterValue(call, 'model_code', 'ilike')).toBe('6954')
    expect(result).toMatchObject({ model_code: '6954', quantity: 12, ubicacion: 'Gaveta B3' })
  })

  test('encuentra códigos almacenados en minúsculas', async () => {
    const client = createMockSupabase({
      responses: {
        'store_inventory.update': {
          data: [{ model_code: 'abc-123x', quantity: 3, location: 'Gaveta A1' }],
          error: null,
        },
      },
    })

    const result = await setInventoryLocation(asDb(client), { model_code: 'ABC-123X', location: 'Gaveta A1' })

    const call = client.callsTo('store_inventory', 'update')[0]
    expect(filterValue(call, 'model_code', 'ilike')).toBe('ABC-123X')
    expect(result).toMatchObject({ model_code: 'abc-123x', ubicacion: 'Gaveta A1' })
  })

  test('escapa los comodines de ilike — el match sigue siendo exacto', async () => {
    const client = createMockSupabase({
      responses: {
        'store_inventory.update': { data: [], error: null },
      },
    })

    await expect(
      setInventoryLocation(asDb(client), { model_code: '50%_A', location: 'X' }),
    ).rejects.toThrow(/no está en el inventario/)

    const call = client.callsTo('store_inventory', 'update')[0]
    expect(filterValue(call, 'model_code', 'ilike')).toBe('50\\%\\_A')
  })

  test('avisa en vez de devolver la primera en silencio si el ilike toca >1 fila', async () => {
    // No debería pasar (model_code es UNIQUE por valor exacto), pero si "abc"
    // y "ABC" coexistieran el ilike case-insensitive tocaría ambas.
    const client = createMockSupabase({
      responses: {
        'store_inventory.update': {
          data: [
            { model_code: 'abc', quantity: 1, location: 'A1' },
            { model_code: 'ABC', quantity: 2, location: 'A1' },
          ],
          error: null,
        },
      },
    })

    await expect(
      setInventoryLocation(asDb(client), { model_code: 'abc', location: 'A1' }),
    ).rejects.toThrow(/coincide con 2 códigos/)
  })

  test('location vacío o ausente borra la ubicación (null) con nota', async () => {
    const client = createMockSupabase({
      responses: {
        'store_inventory.update': {
          data: [{ model_code: 'X1', quantity: 3, location: null }],
          error: null,
        },
      },
    })

    const result = await setInventoryLocation(asDb(client), { model_code: 'x1', location: '   ' })

    expect(client.updatePayload('store_inventory')).toEqual({ location: null })
    expect(result.nota).toMatch(/borrada/i)
  })

  test('sin fila de inventario → ToolError accionable (no se crea la fila)', async () => {
    const client = createMockSupabase({
      responses: { 'store_inventory.update': { data: [], error: null } },
    })
    await expect(
      setInventoryLocation(asDb(client), { model_code: 'NOEXISTE', location: 'G-9' }),
    ).rejects.toThrow(/no está en el inventario/)
  })

  test('sin model_code → ToolError sin tocar la BD', async () => {
    const client = createMockSupabase({ responses: {} })
    await expect(setInventoryLocation(asDb(client), { location: 'G-1' })).rejects.toThrow(ToolError)
    expect(client.callsTo('store_inventory', 'update')).toHaveLength(0)
  })
})
