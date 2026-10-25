/** applyCuratedGuard and nextDymmsaCode (#155 D): shared by PATCH /api/products/[id], next-dymmsa-code and save_product. */

import { describe, test, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyCuratedGuard, nextDymmsaCode } from '@/lib/products-store'
import { createMockSupabase } from '../helpers/supabase-mock'
import type { EtmProduct } from '@/types/database'

const asDb = (mock: ReturnType<typeof createMockSupabase>) => mock as unknown as SupabaseClient
const PRODUCT = { id: 'x', etm: 'E1', model_code: 'MC1', brand: 'URREA', dymmsa_description: 'Mi texto' } as EtmProduct
const OFFICIAL = { data: [{ code: 'MC1', brand: 'URREA', description: 'Oficial' }], error: null }

describe('applyCuratedGuard', () => {
  test('sin curada en el cambio no consulta el catálogo', async () => {
    const mock = createMockSupabase()
    expect(await applyCuratedGuard(asDb(mock), PRODUCT, { price: 5 })).toEqual({ price: 5 })
    expect(mock.didCall('urrea_catalog', 'select')).toBe(false)
  })

  test('reenviar el valor guardado no es una edición: se quita del cambio, aunque el catálogo gane', async () => {
    const mock = createMockSupabase({ responses: { 'urrea_catalog.select': OFFICIAL } })
    expect(await applyCuratedGuard(asDb(mock), PRODUCT, { dymmsa_description: 'Mi texto', price: 5 })).toEqual({ price: 5 })
  })

  test('REGLA: un texto nuevo con descripción oficial para (código, marca) se rechaza; sin match pasa', async () => {
    const official = createMockSupabase({ responses: { 'urrea_catalog.select': OFFICIAL } })
    await expect(applyCuratedGuard(asDb(official), PRODUCT, { dymmsa_description: 'Otro' })).rejects.toMatchObject({ status: 400 })
    const free = createMockSupabase({ responses: { 'urrea_catalog.select': { data: [], error: null } } })
    expect(await applyCuratedGuard(asDb(free), PRODUCT, { dymmsa_description: 'Otro' })).toEqual({ dymmsa_description: 'Otro' })
  })

  test('usa el código y la marca NUEVOS del mismo cambio para decidir', async () => {
    const mock = createMockSupabase({ responses: { 'urrea_catalog.select': { data: [{ code: 'MC2', brand: 'SURTEK', description: 'Oficial' }], error: null } } })
    await expect(applyCuratedGuard(asDb(mock), PRODUCT, { model_code: 'MC2', brand: 'SURTEK', dymmsa_description: 'Otro' })).rejects.toMatchObject({ status: 400 })
  })
})

describe('nextDymmsaCode', () => {
  test('uno más que el mayor DYMMSA-N; ignora los que no son consecutivos', async () => {
    const mock = createMockSupabase({ responses: { 'etm_products.select': { data: [{ etm: 'DYMMSA-3' }, { etm: 'DYMMSA-12' }, { etm: 'DYMMSA-TEMP-1' }], error: null } } })
    expect(await nextDymmsaCode(asDb(mock))).toBe(13)
  })

  test('sin ninguno arranca en 1; un fallo de lectura es 500 (antes devolvía 1 en silencio y chocaba)', async () => {
    expect(await nextDymmsaCode(asDb(createMockSupabase()))).toBe(1)
    const broken = createMockSupabase({ responses: { 'etm_products.select': { data: null, error: { message: 'boom' } } } })
    await expect(nextDymmsaCode(asDb(broken))).rejects.toMatchObject({ status: 500 })
  })
})
