/**
 * Tools MCP del módulo Catálogo ETM (solo lectura).
 * Resuelve la Descripción DYMMSA en vivo con la jerarquía de catálogo
 * (catálogo URREA > curada > null, ADR-013) — el LLM recibe el valor final.
 */

import { resolveDymmsaDescription } from '@/lib/business-rules'
import { fetchCatalogDescriptionMap } from '@/lib/urrea-catalog'
import { normalizePagination, sanitizeSearch, ToolError, type Db } from '../shared'
import type { EtmProduct } from '@/types/database'

export interface SearchProductsInput {
  query: string
  page?: number
  pageSize?: number
}

export async function searchProducts(db: Db, input: SearchProductsInput) {
  const { page, pageSize, from, to } = normalizePagination(input)

  const search = sanitizeSearch(input.query)
  if (!search) throw new ToolError('La búsqueda no puede estar vacía')

  const { data, error, count } = await db
    .from('etm_products')
    .select('*', { count: 'exact' })
    .or(
      `etm.ilike.%${search}%,model_code.ilike.%${search}%,description.ilike.%${search}%,description_es.ilike.%${search}%`,
    )
    .order('etm', { ascending: true })
    .range(from, to)

  if (error) throw new ToolError(`Error al buscar productos: ${error.message}`)

  const rows = (data ?? []) as EtmProduct[]
  const catalogMap = await fetchCatalogDescriptionMap(
    db,
    rows.map((p) => p.model_code),
  )

  const products = rows.map((p) => {
    const resolved = resolveDymmsaDescription(
      {
        item_type: 'product',
        model_code: p.model_code,
        brand: p.brand,
        dymmsa_description: p.dymmsa_description,
      },
      catalogMap,
    )
    return {
      etm: p.etm,
      model_code: p.model_code,
      brand: p.brand,
      description: p.description_es || p.description,
      dymmsa_description: resolved.value,
      dymmsa_description_source: resolved.source,
      price: p.price,
      is_sold: p.is_sold,
    }
  })

  return { products, count: count ?? 0, page, pageSize, totalPages: Math.ceil((count ?? 0) / pageSize) }
}
