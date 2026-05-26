/**
 * Fase 4 — Inventario / productos.
 *
 *   - inventory/import:  validación de archivo/columnas, modos upsert/replace,
 *                        clamp de cantidades negativas a 0.
 *   - products/import:   validación de columnas, upsert (update vs insert),
 *                        brand por defecto 'URREA', filas sin ETM = error.
 *   - orders/auto-learn: validación, skip de campos incompletos, existing vs added,
 *                        siempre inserta brand='URREA'.
 */

import { describe, test, expect, mock } from 'bun:test'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { makeRequest, makeParams, makeExcelRequest } from '../helpers/request'

let activeClient: MockSupabaseClient
mock.module('@/lib/supabase/server', () => ({
  createClient: async () => activeClient,
}))

const inventoryImport = await import('@/app/api/inventory/import/route')
const productsImport   = await import('@/app/api/products/import/route')
const autoLearn        = await import('@/app/api/orders/auto-learn/route')

const AUTH = { id: 'user-1' }

// ─── inventory/import ──────────────────────────────────────────────────────

describe('POST /inventory/import', () => {
  test('400 si no se envía archivo', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await inventoryImport.POST(makeExcelRequest([], { omitFile: true }))
    expect(res.status).toBe(400)
  })

  test('400 si el archivo no tiene datos', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await inventoryImport.POST(makeExcelRequest([]))
    expect(res.status).toBe(400)
  })

  test('400 si falta la columna MODEL_CODE', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await inventoryImport.POST(makeExcelRequest([{ FOO: 'bar', QUANTITY: 5 }]))
    expect(res.status).toBe(400)
  })

  test('upsert: actualiza cuando el model_code ya existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'store_inventory.select': { data: { id: 'inv1' }, error: null },
        'store_inventory.update': { data: null, error: null },
      },
    })
    const res = await inventoryImport.POST(makeExcelRequest([{ MODEL_CODE: 'MC1', QUANTITY: 9 }]))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated).toBe(1)
    expect(body.imported).toBe(0)
  })

  test('upsert: inserta cuando el model_code no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'store_inventory.select': { data: null, error: null },
        'store_inventory.insert': { data: null, error: null },
      },
    })
    const res = await inventoryImport.POST(makeExcelRequest([{ MODEL_CODE: 'MC2', QUANTITY: 3 }]))
    const body = await res.json()
    expect(body.imported).toBe(1)
    expect(body.updated).toBe(0)
  })

  test('REGLA: cantidad negativa se recorta a 0', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'store_inventory.select': { data: null, error: null },
        'store_inventory.insert': { data: null, error: null },
      },
    })
    await inventoryImport.POST(makeExcelRequest([{ MODEL_CODE: 'MC3', QUANTITY: -5 }]))
    const payload = activeClient.callsTo('store_inventory', 'insert')[0].payload as Record<string, unknown>
    expect(payload.quantity).toBe(0)
  })

  test('modo replace: borra todo e inserta', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'store_inventory.delete': { data: null, error: null },
        'store_inventory.insert': { data: null, error: null },
      },
    })
    const res = await inventoryImport.POST(
      makeExcelRequest([{ MODEL_CODE: 'MC1', QUANTITY: 5 }, { MODEL_CODE: 'MC2', QUANTITY: 2 }], { mode: 'replace' }),
    )
    const body = await res.json()
    expect(body.mode).toBe('replace')
    expect(body.imported).toBe(2)
    expect(activeClient.didCall('store_inventory', 'delete')).toBe(true)
  })
})

// ─── products/import ───────────────────────────────────────────────────────

describe('POST /products/import', () => {
  test('400 si faltan columnas ETM / MODEL_CODE', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await productsImport.POST(makeExcelRequest([{ DESCRIPTION: 'x' }]))
    expect(res.status).toBe(400)
  })

  test('upsert: inserta producto nuevo con brand por defecto URREA', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'etm_products.select': { data: null, error: null },
        'etm_products.insert': { data: null, error: null },
      },
    })
    const res = await productsImport.POST(makeExcelRequest([{ ETM: 'E1', MODEL_CODE: 'MC1', DESCRIPTION: 'Prod', PRICE: 100 }]))
    const body = await res.json()
    expect(body.imported).toBe(1)
    const payload = activeClient.callsTo('etm_products', 'insert')[0].payload as Record<string, unknown>
    expect(payload.brand).toBe('URREA')
    expect(payload.created_by).toBe('user-1')
  })

  test('upsert: actualiza cuando el ETM ya existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'etm_products.select': { data: { id: 'p1' }, error: null },
        'etm_products.update': { data: null, error: null },
      },
    })
    const res = await productsImport.POST(makeExcelRequest([{ ETM: 'E1', MODEL_CODE: 'MC1', BRAND: 'TRUPER', PRICE: 50 }]))
    const body = await res.json()
    expect(body.updated).toBe(1)
    // respeta brand explícito
    const payload = activeClient.callsTo('etm_products', 'update')[0].payload as Record<string, unknown>
    expect(payload.brand).toBe('TRUPER')
  })

  test('fila sin ETM cuenta como error', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'etm_products.select': { data: null, error: null },
        'etm_products.insert': { data: null, error: null },
      },
    })
    // columna ETM presente (para pasar validación) pero valor vacío en la fila
    const res = await productsImport.POST(makeExcelRequest([{ ETM: '', MODEL_CODE: 'MC1' }]))
    const body = await res.json()
    expect(body.errors).toBe(1)
    expect(body.imported).toBe(0)
  })
})

// ─── orders/auto-learn ─────────────────────────────────────────────────────

describe('POST /orders/auto-learn', () => {
  test('400 si products no es un array', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await autoLearn.POST(makeRequest({ products: 'nope' }))
    expect(res.status).toBe(400)
  })

  test('skip cuando faltan campos requeridos (sin model_code)', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await autoLearn.POST(makeRequest({
      products: [{ etm: 'E1', description: 'P', price: 10 /* sin model_code */ }],
    }))
    const body = await res.json()
    expect(body.skipped).toBe(1)
    expect(body.added).toBe(0)
  })

  test('existing: no inserta si el ETM ya existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'etm_products.select': { data: { id: 'p1' }, error: null } },
    })
    const res = await autoLearn.POST(makeRequest({
      products: [{ etm: 'E1', description: 'P', model_code: 'MC1', price: 10 }],
    }))
    const body = await res.json()
    expect(body.existing).toBe(1)
    expect(activeClient.didCall('etm_products', 'insert')).toBe(false)
  })

  test('REGLA: inserta producto nuevo con brand=URREA y created_by', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'etm_products.select': { data: null, error: null },
        'etm_products.insert': { data: null, error: null },
      },
    })
    const res = await autoLearn.POST(makeRequest({
      products: [{ etm: 'E1', description: 'P', model_code: 'MC1', price: 10 }],
    }))
    const body = await res.json()
    expect(body.added).toBe(1)
    const payload = activeClient.callsTo('etm_products', 'insert')[0].payload as Record<string, unknown>
    expect(payload.brand).toBe('URREA')
    expect(payload.created_by).toBe('user-1')
  })
})
