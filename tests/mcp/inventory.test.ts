/** Tools MCP de inventario. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, hasFilter } from '../helpers/supabase-mock'
import { searchInventory, getInventoryStats } from '@/lib/mcp/tools/inventory'
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
