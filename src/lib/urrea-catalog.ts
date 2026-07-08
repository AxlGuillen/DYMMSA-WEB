/**
 * Acceso compartido al catálogo URREA para la resolución de descripciones.
 *
 * La llave de cruce es `urrea_catalog.code` ↔ `model_code`, SIEMPRE normalizada
 * con `normalizeCatalogCode` (trim + mayúsculas) en ambos lados — un espacio o
 * minúscula hace fallar el match en silencio.
 */

import { normalizeCatalogCode } from '@/lib/business-rules'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Trae las descripciones del catálogo para un lote de códigos (una sola query).
 * Devuelve un Map<code normalizado, descripción> — el formato que consume
 * `resolveDymmsaDescription`. Códigos vacíos se descartan; lote vacío no consulta.
 */
export async function fetchCatalogDescriptionMap(
  supabase: SupabaseServerClient,
  codes: (string | null | undefined)[],
): Promise<Map<string, string | null>> {
  const normalized = [...new Set(codes.map(normalizeCatalogCode).filter(Boolean))]
  if (normalized.length === 0) return new Map()

  const { data, error } = await supabase
    .from('urrea_catalog')
    .select('code, description')
    .in('code', normalized)

  if (error || !data) {
    // La resolución degrada a "sin catálogo" (curada/vacío); el guardado no debe
    // fallar porque el catálogo no respondió.
    if (error) console.warn('fetchCatalogDescriptionMap error (ignored):', error)
    return new Map()
  }

  return new Map(data.map((row) => [normalizeCatalogCode(row.code), row.description]))
}
