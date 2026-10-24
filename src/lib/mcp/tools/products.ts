/** ETM catalog tools (read); the DYMMSA description is returned already resolved (ADR-013). */

import { resolveDymmsaDescription } from '@/lib/business-rules'
import { fetchCatalogDescriptionMap } from '@/lib/urrea-catalog'
import { listResult } from '@/lib/mcp/core/envelope'
import { normalizePagination } from '@/lib/mcp/core/schema'
import { sanitizeSearch } from '@/lib/text'
import { soldToken } from '@/lib/tokens'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import type { EtmProduct } from '@/types/database'

export interface SearchProductsInput {
  buscar: string
  pagina?: number
  por_pagina?: number
}

/** Where the resolved DYMMSA description came from, as the assistant says it. */
const DESCRIPTION_SOURCE = { catalog: 'catalogo', dymmsa: 'curada' } as const

export async function searchProducts(db: Db, input: SearchProductsInput) {
  const { pagina, por_pagina, from, to } = normalizePagination(input)

  const search = sanitizeSearch(input.buscar)
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
      codigo: p.model_code,
      marca: p.brand,
      descripcion: p.description_es || p.description,
      descripcion_dymmsa: resolved.value,
      fuente_descripcion_dymmsa: resolved.source ? DESCRIPTION_SOURCE[resolved.source] : null,
      precio: p.price,
      se_vende: soldToken(p.is_sold),
    }
  })

  return listResult('productos', products, { total: count ?? 0, pagina, por_pagina })
}
