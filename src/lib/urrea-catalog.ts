/**
 * Acceso compartido al catálogo URREA para la resolución de descripciones.
 *
 * La llave de cruce es **(código, marca)** — `urrea_catalog` tiene identidad
 * `UNIQUE(code, brand)` porque el mismo código puede existir en varias marcas.
 * Ambas partes se normalizan (trim + mayúsculas) con `catalogKey` en los dos
 * lados: un espacio o una minúscula hace fallar el match en silencio.
 *
 * La QUERY sigue siendo por código (trae todas las marcas de esos códigos) y el
 * mapa resultante se indexa por `catalogKey` — así quien resuelve elige la fila
 * de SU marca sin que el llamador tenga que mandar marcas.
 */

import { catalogKey, normalizeCatalogCode } from '@/lib/business-rules'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Trae las descripciones del catálogo para un lote de códigos (una sola query).
 * Devuelve un `Map<catalogKey(code, brand), descripción>` — el formato que
 * consume `resolveDymmsaDescription`. Códigos vacíos se descartan; lote vacío
 * no consulta.
 */
export async function fetchCatalogDescriptionMap(
  supabase: SupabaseServerClient,
  codes: (string | null | undefined)[],
): Promise<Map<string, string | null>> {
  const normalized = [...new Set(codes.map(normalizeCatalogCode).filter(Boolean))]
  if (normalized.length === 0) return new Map()

  const { data, error } = await supabase
    .from('urrea_catalog')
    .select('code, brand, description')
    .in('code', normalized)

  if (error || !data) {
    // La resolución degrada a "sin catálogo" (curada/vacío); el guardado no debe
    // fallar porque el catálogo no respondió.
    if (error) console.warn('fetchCatalogDescriptionMap error (ignored):', error)
    return new Map()
  }

  return new Map(data.map((row) => [catalogKey(row.code, row.brand), row.description]))
}
