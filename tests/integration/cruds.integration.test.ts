/**
 * Integración (Fase C1 · capa 1 — CRUDs) contra el Supabase LOCAL.
 * Se enfoca en lo que el mock NO puede verificar: constraints REALES de la BD
 * (UNIQUE compuesto, normalización + UNIQUE, FK sin cascade) y RLS.
 *
 * Requiere `bunx supabase start`. Correr con: bun run test:integration
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import { authedClient } from './helpers/clients'
import { resetDb, sql, closePool } from './helpers/db'
import * as catalog from '@/app/api/urrea-catalog/route'
import * as brands from '@/app/api/brands/route'
import * as brandById from '@/app/api/brands/[id]/route'
import * as inventory from '@/app/api/inventory/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

beforeAll(async () => { activeClient = await authedClient() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

// ─── urrea_catalog: normalización + UNIQUE(code, brand) ──────────────────────

describe('urrea_catalog CRUD (constraints reales)', () => {
  test('crea normalizando code/brand a trim+upper y persiste así en la BD', async () => {
    const res = await catalog.POST(makeRequest({ code: '  crud-1 ', brand: ' urrea ', description: 'X', std: 10 }))
    expect(res.status).toBe(201)
    const [row] = await sql<{ code: string; brand: string }>(
      "SELECT code, brand FROM urrea_catalog WHERE description = 'X'",
    )
    expect(row).toMatchObject({ code: 'CRUD-1', brand: 'URREA' }) // normalizado en la BD real
  })

  test('duplicado (mismo code+brand, otra capitalización) → 400 por el UNIQUE real', async () => {
    expect((await catalog.POST(makeRequest({ code: 'CRUD-2', brand: 'URREA', std: 1 }))).status).toBe(201)
    // Distinta capitalización → tras normalizar es EL MISMO (code, brand).
    const dup = await catalog.POST(makeRequest({ code: ' crud-2 ', brand: 'urrea', std: 1 }))
    expect(dup.status).toBe(400)
  })

  test('mismo code, OTRA marca → permitido (identidad = code+brand)', async () => {
    expect((await catalog.POST(makeRequest({ code: 'CRUD-3', brand: 'URREA', std: 1 }))).status).toBe(201)
    // La identidad es compuesta: el mismo código bajo otra marca es válido.
    const other = await catalog.POST(makeRequest({ code: 'CRUD-3', brand: 'SURTEK', std: 1 }))
    expect(other.status).toBe(201)
    const rows = await sql("SELECT 1 FROM urrea_catalog WHERE code = 'CRUD-3'")
    expect(rows).toHaveLength(2)
  })
})

// ─── inventory: UNIQUE(model_code) + clamp de cantidad ───────────────────────

describe('store_inventory CRUD (constraints reales)', () => {
  test('duplicado de model_code → 400 por el UNIQUE real', async () => {
    expect((await inventory.POST(makeRequest({ model_code: '80001', quantity: 5 }))).status).toBe(201)
    const dup = await inventory.POST(makeRequest({ model_code: '80001', quantity: 9 }))
    expect(dup.status).toBe(400)
  })

  test('cantidad negativa se clampa a 0 y persiste sin violar el CHECK(qty>=0)', async () => {
    const res = await inventory.POST(makeRequest({ model_code: '80002', quantity: -7 }))
    expect(res.status).toBe(201)
    const [row] = await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '80002'")
    expect(row.quantity).toBe(0)
  })
})

// ─── brands: FK sin cascade bloquea el borrado de una marca en uso ───────────

describe('brands CRUD (FK real bloquea borrar en uso)', () => {
  test('marca asignada a un proveedor NO se puede borrar (400); libre sí (200)', async () => {
    // Crear marca vía handler (normaliza a upper).
    const created = await brands.POST(makeRequest({ name: 'martillos' }))
    expect(created.status).toBe(201)
    const brand = await readJson<{ id: string; name: string }>(created)
    expect(brand.name).toBe('MARTILLOS')

    // Asignarla a un proveedor (arreglo de estado vía SQL directo).
    await sql(
      "INSERT INTO suppliers (id, name) VALUES ('00000000-0000-0000-0000-0000000000b1', 'Prov Test')",
    )
    await sql('INSERT INTO supplier_brands (supplier_id, brand_id) VALUES ($1, $2)', [
      '00000000-0000-0000-0000-0000000000b1',
      brand.id,
    ])

    // Borrado bloqueado por el pre-check / FK.
    const blocked = await brandById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: brand.id }))
    expect(blocked.status).toBe(400)
    expect(await sql('SELECT 1 FROM brands WHERE id = $1', [brand.id])).toHaveLength(1) // sigue viva

    // Desasignar → ahora sí borra.
    await sql('DELETE FROM supplier_brands WHERE brand_id = $1', [brand.id])
    const ok = await brandById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: brand.id }))
    expect(ok.status).toBe(200)
    expect(await sql('SELECT 1 FROM brands WHERE id = $1', [brand.id])).toHaveLength(0)
  })
})
