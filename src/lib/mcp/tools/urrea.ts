/**
 * Tools MCP del módulo Catálogo URREA (solo lectura).
 * La llave de cruce se normaliza SIEMPRE con normalizeCatalogCode (trim+upper).
 */

import { normalizeCatalogCode } from '@/lib/business-rules'
import { ToolError, type Db } from '../shared'
import type { UrreaCatalogItem } from '@/types/database'

export async function searchUrreaCatalog(db: Db, rawQuery: string) {
  const query = rawQuery.trim()
  if (!query) throw new ToolError('La búsqueda no puede estar vacía')

  // 1. Match exacto por código normalizado (el caso típico: "¿qué es el 6954?")
  const code = normalizeCatalogCode(query)
  const { data: exact, error: exactError } = await db
    .from('urrea_catalog')
    .select('code, brand, description, std')
    .eq('code', code)
    .maybeSingle()

  if (exactError) throw new ToolError(`Error al consultar el catálogo: ${exactError.message}`)
  if (exact) return { match: 'exact' as const, items: [exact as Pick<UrreaCatalogItem, 'code' | 'brand' | 'description' | 'std'>] }

  // 2. Búsqueda parcial por código o descripción
  const sanitized = query.replace(/[,()%]/g, ' ').trim()
  const { data, error } = await db
    .from('urrea_catalog')
    .select('code, brand, description, std')
    .or(`code.ilike.%${sanitized}%,description.ilike.%${sanitized}%`)
    .order('code', { ascending: true })
    .limit(20)

  if (error) throw new ToolError(`Error al consultar el catálogo: ${error.message}`)

  const items = (data ?? []) as Pick<UrreaCatalogItem, 'code' | 'brand' | 'description' | 'std'>[]
  if (items.length === 0) {
    return { match: 'none' as const, items: [], message: `Sin resultados para "${query}" en el catálogo URREA` }
  }
  return { match: 'partial' as const, items }
}
