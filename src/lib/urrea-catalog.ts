/**
 * Acceso al catálogo URREA: query por código, mapa indexado por catalogKey
 * (code+brand) — quien resuelve elige la fila de SU marca (ADR-013).
 */

import { catalogKey, normalizeCatalogCode } from '@/lib/business-rules'
import type { CatalogEntry } from '@/lib/purchase-plan'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** Descripciones por lote en una query → Map<catalogKey, descripción> para resolveDymmsaDescription. */
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

/** Variante con STD para el planificador (ADR-018); si el catálogo falla → mapa vacío, el plan no truena. */
export async function fetchCatalogEntryMap(
  supabase: SupabaseServerClient,
  codes: (string | null | undefined)[],
): Promise<Map<string, CatalogEntry>> {
  const normalized = [...new Set(codes.map(normalizeCatalogCode).filter(Boolean))]
  if (normalized.length === 0) return new Map()

  const { data, error } = await supabase
    .from('urrea_catalog')
    .select('code, brand, description, std')
    .in('code', normalized)

  if (error || !data) {
    if (error) console.warn('fetchCatalogEntryMap error (ignored):', error)
    return new Map()
  }

  return new Map(
    data.map((row) => [
      catalogKey(row.code, row.brand),
      { std: row.std, description: row.description },
    ]),
  )
}
