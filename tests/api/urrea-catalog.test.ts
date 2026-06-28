/**
 * URREA Catalog — import handler (tabla aislada urrea_catalog).
 *   - validación de archivo/columnas
 *   - upsert por code (onConflict)
 *   - replace (delete all + insert)
 *   - parseo de std (entero ≥ 1, default) y precio (numérico/null)
 *   - acepta encabezados en español (codigo/descripcion/precio)
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeExcelRequest } from '../helpers/request'
import * as catalogImport from '@/app/api/urrea-catalog/import/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

describe('POST /urrea-catalog/import', () => {
  test('400 sin archivo', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await catalogImport.POST(makeExcelRequest([], { omitFile: true }))
    expect(res.status).toBe(400)
  })

  test('400 si el archivo no tiene datos', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await catalogImport.POST(makeExcelRequest([]))
    expect(res.status).toBe(400)
  })

  test('400 si falta la columna codigo', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await catalogImport.POST(makeExcelRequest([{ foo: 'bar', precio: 10 }]))
    expect(res.status).toBe(400)
  })

  test('upsert: llama upsert onConflict code con encabezados en español', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.upsert': { data: null, error: null } },
    })
    const res = await catalogImport.POST(
      makeExcelRequest([{ codigo: 'C1', descripcion: 'Tornillo', std: 6, precio: 12.5 }]),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imported).toBe(1)
    expect(activeClient.didCall('urrea_catalog', 'upsert')).toBe(true)
    const payload = activeClient.upsertPayload<Record<string, unknown>[]>('urrea_catalog')
    expect(payload[0]).toMatchObject({ code: 'C1', description: 'Tornillo', std: 6, price: 12.5 })
  })

  test('std vacío/0 cae a 1 y precio vacío a null', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'urrea_catalog.upsert': { data: null, error: null } },
    })
    await catalogImport.POST(makeExcelRequest([{ codigo: 'C2', descripcion: 'X' }]))
    const payload = activeClient.upsertPayload<Record<string, unknown>[]>('urrea_catalog')
    expect(payload[0].std).toBe(1)
    expect(payload[0].price).toBeNull()
  })

  test('modo replace: borra todo e inserta', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'urrea_catalog.delete': { data: null, error: null },
        'urrea_catalog.insert': { data: null, error: null },
      },
    })
    const res = await catalogImport.POST(
      makeExcelRequest([{ codigo: 'C1', precio: 1 }, { codigo: 'C2', precio: 2 }], { mode: 'replace' }),
    )
    const body = await res.json()
    expect(body.mode).toBe('replace')
    expect(body.imported).toBe(2)
    expect(activeClient.didCall('urrea_catalog', 'delete')).toBe(true)
    expect(activeClient.didCall('urrea_catalog', 'insert')).toBe(true)
  })
})
