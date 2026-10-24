import { describe, test, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  adjustInventory,
  computeRestoration,
  deleteRestoresStock,
  goodsInStore,
  isOrderClosed,
  releaseInventory,
  reserveInventory,
  reservedLines,
  restorationLines,
} from '@/lib/inventory'
import { createMockSupabase } from '../helpers/supabase-mock'

const asDb = (client: ReturnType<typeof createMockSupabase>) => client as unknown as SupabaseClient

function makeItem(overrides: Partial<{
  model_code: string | null
  quantity_in_stock: number
  quantity_received: number
  quantity_to_order: number
}> = {}) {
  const base = {
    model_code:        'MC-001',
    quantity_in_stock: 0,
    quantity_received: 0,
    ...overrides,
  }
  // Default: what was ordered covers what was received (no excess) — legacy case.
  return { quantity_to_order: base.quantity_received, ...base } as {
    model_code: string | null
    quantity_in_stock: number
    quantity_received: number
    quantity_to_order: number
  }
}

describe('computeRestoration', () => {
  test('sums quantity_in_stock + min(recibido, pedido)', () => {
    const items = [makeItem({ quantity_in_stock: 3, quantity_received: 2 })]
    const result = computeRestoration(items)
    expect(result).toHaveLength(1)
    expect(result[0].quantityToRestore).toBe(5)
    expect(result[0].model_code).toBe('MC-001')
  })

  test('excludes items with null model_code', () => {
    const items = [
      makeItem({ model_code: null, quantity_in_stock: 5, quantity_received: 2 }),
      makeItem({ model_code: 'MC-002', quantity_in_stock: 3, quantity_received: 0 }),
    ]
    const result = computeRestoration(items)
    expect(result).toHaveLength(1)
    expect(result[0].model_code).toBe('MC-002')
  })

  test('REGLA CRÍTICA: excludes items where quantityToRestore === 0', () => {
    const items = [
      makeItem({ model_code: 'MC-001', quantity_in_stock: 0, quantity_received: 0 }),
      makeItem({ model_code: 'MC-002', quantity_in_stock: 2, quantity_received: 1 }),
    ]
    const result = computeRestoration(items)
    expect(result).toHaveLength(1)
    expect(result[0].model_code).toBe('MC-002')
    expect(result[0].quantityToRestore).toBe(3)
  })

  test('excludes items where both in_stock and received are 0', () => {
    const items = [makeItem({ quantity_in_stock: 0, quantity_received: 0 })]
    expect(computeRestoration(items)).toHaveLength(0)
  })

  test('includes item when only quantity_in_stock > 0', () => {
    const items = [makeItem({ quantity_in_stock: 4, quantity_received: 0 })]
    const result = computeRestoration(items)
    expect(result).toHaveLength(1)
    expect(result[0].quantityToRestore).toBe(4)
  })

  test('includes item when only quantity_received > 0', () => {
    const items = [makeItem({ quantity_in_stock: 0, quantity_received: 7 })]
    const result = computeRestoration(items)
    expect(result).toHaveLength(1)
    expect(result[0].quantityToRestore).toBe(7)
  })

  test('REGLA CRÍTICA: does NOT merge duplicate model_codes (DB handles that)', () => {
    const items = [
      makeItem({ model_code: 'MC-001', quantity_in_stock: 3, quantity_received: 0 }),
      makeItem({ model_code: 'MC-001', quantity_in_stock: 2, quantity_received: 1 }),
    ]
    const result = computeRestoration(items)
    // Two separate entries — not merged
    expect(result).toHaveLength(2)
    expect(result[0].quantityToRestore).toBe(3)
    expect(result[1].quantityToRestore).toBe(3)
  })

  test('handles mixed items: some valid, some filtered', () => {
    const items = [
      makeItem({ model_code: null,    quantity_in_stock: 5, quantity_received: 0 }), // excluded: null code
      makeItem({ model_code: 'MC-A',  quantity_in_stock: 0, quantity_received: 0 }), // excluded: zero qty
      makeItem({ model_code: 'MC-B',  quantity_in_stock: 2, quantity_received: 3 }), // included: 5
      makeItem({ model_code: 'MC-C',  quantity_in_stock: 1, quantity_received: 0 }), // included: 1
    ]
    const result = computeRestoration(items)
    expect(result).toHaveLength(2)
    expect(result.find((r) => r.model_code === 'MC-B')?.quantityToRestore).toBe(5)
    expect(result.find((r) => r.model_code === 'MC-C')?.quantityToRestore).toBe(1)
  })

  test('returns empty array for empty input', () => {
    expect(computeRestoration([])).toHaveLength(0)
  })

  test('returns empty array when all items are filtered out', () => {
    const items = [
      makeItem({ model_code: null, quantity_in_stock: 5 }),
      makeItem({ model_code: 'MC-X', quantity_in_stock: 0, quantity_received: 0 }),
    ]
    expect(computeRestoration(items)).toHaveLength(0)
  })

  test('REGLA (ADR-019): el excedente NO se restaura — ya entró al confirmar recepción', () => {
    // in_stock 3 + min(10, 2) = 5; the 8 excess units are already in inventory.
    const items = [makeItem({ quantity_in_stock: 3, quantity_received: 10, quantity_to_order: 2 })]
    const result = computeRestoration(items)
    expect(result[0].quantityToRestore).toBe(5)
  })

  test('to_order 0 con received > 0 → solo restaura in_stock', () => {
    // Item covered by stock: any received amount would be pure excess.
    const items = [makeItem({ quantity_in_stock: 4, quantity_received: 3, quantity_to_order: 0 })]
    const result = computeRestoration(items)
    expect(result[0].quantityToRestore).toBe(4)
  })

  test('model_code vacío (string) también se excluye', () => {
    const items = [makeItem({ model_code: '  ', quantity_in_stock: 5 })]
    expect(computeRestoration(items)).toHaveLength(0)
  })

  test('works with extra fields (generic T extends RestorableItem)', () => {
    const items = [
      {
        model_code:        'MC-999',
        quantity_in_stock: 3,
        quantity_received: 1,
        quantity_to_order: 1,
        item_type:         'product',     // extra field
        some_other_field:  'ignored',     // extra field
      },
    ]
    const result = computeRestoration(items)
    expect(result).toHaveLength(1)
    expect(result[0].model_code).toBe('MC-999')
    expect(result[0].quantityToRestore).toBe(4)
  })
})

describe('deleteRestoresStock (ADR-010)', () => {
  test('pedida o recibida: el stock sigue en tienda → se restaura', () => {
    expect(deleteRestoresStock('ordered')).toBe(true)
    expect(deleteRestoresStock('received')).toBe(true)
  })

  test('cancelada: la cancelación ya lo restauró → no se duplica', () => {
    expect(deleteRestoresStock('cancelled')).toBe(false)
  })

  test('entregada o completada: los productos ya salieron con el cliente → no se restaura', () => {
    expect(deleteRestoresStock('delivered')).toBe(false)
    expect(deleteRestoresStock('completed')).toBe(false)
  })
})

describe('goodsInStore / isOrderClosed (#157)', () => {
  test('REGLA: solo pedida o recibida se cancela o gana/pierde líneas; entregada ya salió con el cliente', () => {
    expect(goodsInStore('ordered')).toBe(true)
    expect(goodsInStore('received')).toBe(true)
    expect(goodsInStore('delivered')).toBe(false)
    expect(goodsInStore('completed')).toBe(false)
    expect(goodsInStore('cancelled')).toBe(false)
  })

  test('completada o cancelada es de solo lectura; entregada todavía corrige precio, entrega y recepción', () => {
    expect(isOrderClosed('completed')).toBe(true)
    expect(isOrderClosed('cancelled')).toBe(true)
    expect(isOrderClosed('delivered')).toBe(false)
    expect(isOrderClosed('ordered')).toBe(false)
  })
})

describe('restorationLines / reservedLines (#157)', () => {
  test('consolida computeRestoration por model_code: una devolución por código', () => {
    const items = [
      makeItem({ model_code: 'MC-001', quantity_in_stock: 3, quantity_received: 0 }),
      makeItem({ model_code: 'MC-001', quantity_in_stock: 2, quantity_received: 1 }),
      makeItem({ model_code: 'MC-002', quantity_in_stock: 0, quantity_received: 0 }),
    ]
    expect(restorationLines(items)).toEqual([{ model_code: 'MC-001', quantity: 6 }])
  })

  test('reservedLines devuelve solo lo que sí se apartó', () => {
    const reservations = new Map([
      ['A', { reserved: 4, location: 'G1' }],
      ['B', { reserved: 0, location: null }],
    ])
    expect(reservedLines(reservations)).toEqual([{ model_code: 'A', quantity: 4 }])
  })
})

describe('funciones atómicas de stock (#157)', () => {
  test('reserveInventory llama reserve_inventory y regresa lo apartado y la gaveta por código', async () => {
    const client = createMockSupabase({
      responses: {
        'rpc.reserve_inventory': {
          data: [{ model_code: 'A', reserved: 3, location: 'G1' }, { model_code: 'B', reserved: 0, location: null }],
          error: null,
        },
      },
    })
    const lines = [{ model_code: 'A', quantity: 5 }, { model_code: 'B', quantity: 1 }]
    const result = await reserveInventory(asDb(client), lines)
    expect(client.rpcParams('reserve_inventory')).toEqual([{ p_lines: lines }])
    expect(result.get('A')).toEqual({ reserved: 3, location: 'G1' })
    expect(result.get('B')).toEqual({ reserved: 0, location: null })
  })

  test('sin líneas no llama a la BD', async () => {
    const client = createMockSupabase()
    expect((await reserveInventory(asDb(client), [])).size).toBe(0)
    expect(await releaseInventory(asDb(client), [])).toBe(0)
    expect(await adjustInventory(asDb(client), 'A', 0)).toEqual({ quantity: null, clamped: false, missing: false })
    expect(await adjustInventory(asDb(client), '  ', 5)).toEqual({ quantity: null, clamped: false, missing: false })
    expect(client._rpcCalls).toEqual([])
  })

  test('un error de la BD se propaga (nunca se toma como "no se apartó nada")', async () => {
    const client = createMockSupabase({
      responses: {
        'rpc.reserve_inventory': { data: null, error: { message: 'boom' } },
        'rpc.release_inventory': { data: null, error: { message: 'boom' } },
        'rpc.adjust_inventory': { data: null, error: { message: 'boom' } },
      },
    })
    await expect(reserveInventory(asDb(client), [{ model_code: 'A', quantity: 1 }])).rejects.toThrow(/reserve_inventory/)
    await expect(releaseInventory(asDb(client), [{ model_code: 'A', quantity: 1 }])).rejects.toThrow(/release_inventory/)
    await expect(adjustInventory(asDb(client), 'A', -1)).rejects.toThrow(/adjust_inventory/)
  })

  test('adjustInventory pasa el delta y lee clamped / missing', async () => {
    const client = createMockSupabase({
      responses: { 'rpc.adjust_inventory': { data: { quantity: 0, clamped: true, missing: false }, error: null } },
    })
    expect(await adjustInventory(asDb(client), 'A', -8)).toEqual({ quantity: 0, clamped: true, missing: false })
    expect(client.rpcParams('adjust_inventory')).toEqual([{ p_model_code: 'A', p_delta: -8 }])
  })
})
