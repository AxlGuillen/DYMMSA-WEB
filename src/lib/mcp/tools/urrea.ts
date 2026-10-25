/** URREA catalog tools (read-only). The join key ALWAYS goes through normalizeCatalogCode (trim+upper). */

import { normalizeCatalogCode } from '@/lib/business-rules'
import { listResult } from '@/lib/mcp/core/envelope'
import { normalizePagination } from '@/lib/mcp/core/schema'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import type { UrreaCatalogItem } from '@/types/database'

type CatalogRow = Pick<UrreaCatalogItem, 'code' | 'brand' | 'description' | 'std'>

const present = (rows: readonly CatalogRow[]) =>
  rows.map((r) => ({ codigo: r.code, marca: r.brand, descripcion: r.description, std: r.std }))

export interface SearchUrreaCatalogInput {
  buscar: string
  pagina?: number
  por_pagina?: number
}

export async function searchUrreaCatalog(db: Db, input: SearchUrreaCatalogInput) {
  const query = input.buscar.trim()
  if (!query) throw new ToolError('La búsqueda no puede estar vacía')

  // Exact match returns ALL brands of the code (identity = code+brand; maybeSingle would throw on 2+).
  const code = normalizeCatalogCode(query)
  const { data: exact, error: exactError } = await db
    .from('urrea_catalog')
    .select('code, brand, description, std')
    .eq('code', code)
    .order('brand', { ascending: true })

  if (exactError) throw new ToolError(`Error al consultar el catálogo: ${exactError.message}`)

  const exactItems = (exact ?? []) as CatalogRow[]
  if (exactItems.length > 0) {
    return { coincidencia: 'exacta' as const, ...listResult('articulos', present(exactItems), { total: exactItems.length, pagina: 1, por_pagina: exactItems.length }) }
  }

  const { pagina, por_pagina, from, to } = normalizePagination(input)
  const sanitized = query.replace(/[,()%]/g, ' ').trim()
  const { data, error, count } = await db
    .from('urrea_catalog')
    .select('code, brand, description, std', { count: 'exact' })
    .or(`code.ilike.%${sanitized}%,description.ilike.%${sanitized}%`)
    .order('code', { ascending: true })
    .range(from, to)

  if (error) throw new ToolError(`Error al consultar el catálogo: ${error.message}`)

  const items = (data ?? []) as CatalogRow[]
  if ((count ?? items.length) === 0) {
    return {
      coincidencia: 'ninguna' as const,
      ...listResult('articulos', [], { total: 0, pagina: 1, por_pagina }, `Sin resultados para "${query}" en el catálogo URREA`),
    }
  }
  return { coincidencia: 'parcial' as const, ...listResult('articulos', present(items), { total: count ?? items.length, pagina, por_pagina }) }
}
