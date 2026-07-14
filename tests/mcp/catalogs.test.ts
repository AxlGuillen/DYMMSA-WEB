/** Tools MCP de catálogos: productos ETM (jerarquía de descripción) y catálogo URREA. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue } from '../helpers/supabase-mock'
import { searchProducts } from '@/lib/mcp/tools/products'
import { searchUrreaCatalog } from '@/lib/mcp/tools/urrea'
import { ToolError, type Db } from '@/lib/mcp/shared'

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
        // Solo 6954 tiene match en el catálogo oficial
        urrea_catalog: { data: [{ code: '6954', description: 'Oficial URREA' }] },
      },
    })

    const result = await searchProducts(asDb(client), { query: 'pinza' })

    expect(result.products[0]).toMatchObject({ dymmsa_description: 'Oficial URREA', dymmsa_description_source: 'catalog' })
    expect(result.products[1]).toMatchObject({ dymmsa_description: 'Curada 2', dymmsa_description_source: 'dymmsa' })
    expect(result.products[2]).toMatchObject({ dymmsa_description: null, dymmsa_description_source: null, is_sold: false })
  })

  test('rechaza búsqueda vacía (tras sanitizar)', async () => {
    const client = createMockSupabase()
    await expect(searchProducts(asDb(client), { query: ' %() ' })).rejects.toThrow(ToolError)
  })
})

describe('searchUrreaCatalog', () => {
  test('match exacto normaliza el código (trim + upper)', async () => {
    const client = createMockSupabase({
      responses: {
        urrea_catalog: { data: [{ code: '6954', brand: 'URREA', description: 'Pinza', std: 1 }] },
      },
    })

    const result = await searchUrreaCatalog(asDb(client), '  6954  ')

    expect(result.match).toBe('exact')
    expect(result.items).toHaveLength(1)
    expect(filterValue(client.callsTo('urrea_catalog', 'select')[0], 'code')).toBe('6954')
  })

  test('REGLA: un código en varias marcas devuelve TODAS (identidad = code+brand)', async () => {
    // Antes esto usaba .maybeSingle() → con ≥2 filas reventaba con PGRST116.
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

    const result = await searchUrreaCatalog(asDb(client), 'tijs9')

    expect(result.match).toBe('exact')
    expect(result.items).toHaveLength(2)
    expect(result.items.map((i) => i.brand)).toEqual(['FOY', 'SURTEK'])
    // una sola query: no cae a la búsqueda parcial
    expect(client.callsTo('urrea_catalog', 'select')).toHaveLength(1)
  })

  test('sin match exacto cae a búsqueda parcial; sin resultados → match none', async () => {
    let call = 0
    const client = createMockSupabase({
      responses: {
        // 1ª llamada (exacta) → sin filas; 2ª (parcial) → lista vacía
        urrea_catalog: () => (++call === 1 ? { data: [] } : { data: [] }),
      },
    })

    const result = await searchUrreaCatalog(asDb(client), 'martillo')

    expect(result.match).toBe('none')
    expect(result.items).toEqual([])
    expect(client.callsTo('urrea_catalog', 'select')).toHaveLength(2)
  })
})
