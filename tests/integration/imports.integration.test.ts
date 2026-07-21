/**
 * Integración (Tier 1) — imports de Excel contra el Supabase LOCAL. El
 * `ON CONFLICT` real es EXACTAMENTE lo que el mock finge, y un import malo
 * corrompe todo el inventario de golpe → alto valor probarlo de verdad.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeExcelRequest } from '../helpers/request'
import { authedClient } from './helpers/clients'
import { resetDb, sql, closePool } from './helpers/db'
import * as invImport from '@/app/api/inventory/import/route'
import * as catImport from '@/app/api/urrea-catalog/import/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

beforeAll(async () => { activeClient = await authedClient() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

describe('POST /inventory/import (integración local)', () => {
  test('upsert actualiza la cantidad y PRESERVA la gaveta si el archivo no la trae', async () => {
    // Fixture: 60001 quantity 5, location 'Gaveta S1'.
    const res = await invImport.POST(makeExcelRequest([{ MODEL_CODE: '60001', QUANTITY: 20 }], { mode: 'upsert' }))
    expect(res.status).toBe(200)

    const [row] = await sql<{ quantity: number; location: string | null }>(
      "SELECT quantity, location FROM store_inventory WHERE model_code = '60001'",
    )
    // Cantidad actualizada, gaveta CONSERVADA (una carga de solo cantidades no la borra).
    expect(row).toMatchObject({ quantity: 20, location: 'Gaveta S1' })
  })

  test('upsert inserta un producto nuevo con su ubicación (alias "ubicacion")', async () => {
    const res = await invImport.POST(
      makeExcelRequest([{ MODEL_CODE: '90000', QUANTITY: 3, ubicacion: 'Gaveta Nueva' }], { mode: 'upsert' }),
    )
    expect(res.status).toBe(200)
    const [row] = await sql<{ quantity: number; location: string | null }>(
      "SELECT quantity, location FROM store_inventory WHERE model_code = '90000'",
    )
    expect(row).toMatchObject({ quantity: 3, location: 'Gaveta Nueva' })
  })

  test('replace borra todo lo anterior y deja solo lo del archivo', async () => {
    const res = await invImport.POST(makeExcelRequest([{ MODEL_CODE: '77777', QUANTITY: 1 }], { mode: 'replace' }))
    expect(res.status).toBe(200)
    const rows = await sql<{ model_code: string }>('SELECT model_code FROM store_inventory')
    expect(rows).toEqual([{ model_code: '77777' }]) // el fixture 60001 desapareció
  })
})

describe('POST /urrea-catalog/import (integración local)', () => {
  test('columna "codigo" faltante → 400', async () => {
    const res = await catImport.POST(makeExcelRequest([{ foo: 'bar' }], { mode: 'upsert' }))
    expect(res.status).toBe(400)
  })

  test('upsert por (code,brand) normalizado actualiza la fila existente del catálogo', async () => {
    // Fixture: 60001|URREA existe. codigo/marca en minúsculas → normaliza y matchea.
    const res = await catImport.POST(
      makeExcelRequest([{ codigo: ' 60001 ', marca: 'urrea', descripcion: 'ACTUALIZADA', std: 8 }], { mode: 'upsert' }),
    )
    expect(res.status).toBe(200)
    const [row] = await sql<{ description: string; std: number }>(
      "SELECT description, std FROM urrea_catalog WHERE code = '60001' AND brand = 'URREA'",
    )
    expect(row).toMatchObject({ description: 'ACTUALIZADA', std: 8 })
  })
})
