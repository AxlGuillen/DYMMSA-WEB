/** MCP catalog tools: ETM products (description hierarchy) and URREA catalog. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue } from '../helpers/supabase-mock'
import { searchProducts } from '@/lib/mcp/tools/products'
import { searchUrreaCatalog } from '@/lib/mcp/tools/urrea'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

describe('searchProducts', () => {
  test('resuelve la Descripción DYMMSA con jerarquía: catálogo > curada > null', async () => {
    const client = createMockSupabase({
      responses: {
        etm_products: {
          data: [
            { etm: 'E1', model_code: '6954', brand: 'URREA', description: 'D', description_es: 'DE', dymmsa_description: 'Curada 1', price: 10, is_sold: true },
            { etm: 'E2', model_code: 'X999', brand: 'URREA', description: 'D', description_es: 'DE', dymmsa_description: 'Curada 2', price: 20, is_sold: null },
            { etm: 'E3', model_code: '', brand: 'OTRA', description: 'D', description_es: 'DE', dymmsa_description: null, price: 30, is_sold: false },
          ],
          count: 3,
        },
        // Only 6954 has a match in the official catalog
        urrea_catalog: { data: [{ code: '6954', description: 'Oficial URREA' }] },
      },
    })

    const result = await searchProducts(asDb(client), { buscar: 'pinza' })

    expect(result.productos[0]).toMatchObject({ descripcion_dymmsa: 'Oficial URREA', fuente_descripcion_dymmsa: 'catalogo' })
    expect(result.productos[1]).toMatchObject({ descripcion_dymmsa: 'Curada 2', fuente_descripcion_dymmsa: 'curada' })
    expect(result.productos[2]).toMatchObject({ descripcion_dymmsa: null, fuente_descripcion_dymmsa: null, se_vende: 'no' })
  })

  test('rechaza búsqueda vacía (tras sanitizar)', async () => {
    const client = createMockSupabase()
    await expect(searchProducts(asDb(client), { buscar: ' %() ' })).rejects.toThrow(ToolError)
  })
})

describe('searchUrreaCatalog', () => {
  test('match exacto normaliza el código (trim + upper)', async () => {
    const client = createMockSupabase({
      responses: {
        urrea_catalog: { data: [{ code: '6954', brand: 'URREA', description: 'Pinza', std: 1 }] },
      },
    })

    const result = await searchUrreaCatalog(asDb(client), { buscar: '  6954  ' })

    expect(result.coincidencia).toBe('exacta')
    expect(result.articulos).toHaveLength(1)
    expect(filterValue(client.callsTo('urrea_catalog', 'select')[0], 'code')).toBe('6954')
  })

  test('REGLA: un código en varias marcas devuelve TODAS (identidad = code+brand)', async () => {
    // This used .maybeSingle() before → with ≥2 rows it blew up with PGRST116.
    const client = createMockSupabase({
      responses: {
        urrea_catalog: {
          data: [
            { code: 'TIJS9', brand: 'FOY', description: 'Tijeras Foy', std: 1 },
            { code: 'TIJS9', brand: 'SURTEK', description: 'Tijeras industriales 9-1/2"', std: 1 },
          ],
        },
      },
    })

    const result = await searchUrreaCatalog(asDb(client), { buscar: 'tijs9' })

    expect(result.coincidencia).toBe('exacta')
    expect(result.articulos).toHaveLength(2)
    expect(result.articulos.map((i) => i.marca)).toEqual(['FOY', 'SURTEK'])
    // a single query: it does not fall back to the partial search
    expect(client.callsTo('urrea_catalog', 'select')).toHaveLength(1)
  })

  test('sin match exacto cae a búsqueda parcial; sin resultados → coincidencia ninguna', async () => {
    let call = 0
    const client = createMockSupabase({
      responses: {
        // 1st call (exact) → no rows; 2nd (partial) → empty list
        urrea_catalog: () => (++call === 1 ? { data: [] } : { data: [] }),
      },
    })

    const result = await searchUrreaCatalog(asDb(client), { buscar: 'martillo' })

    expect(result.coincidencia).toBe('ninguna')
    expect(result.articulos).toEqual([])
    expect(client.callsTo('urrea_catalog', 'select')).toHaveLength(2)
  })
})
