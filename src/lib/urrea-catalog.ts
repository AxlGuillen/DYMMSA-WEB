/** URREA catalog access. Maps are indexed by catalogKey (code+brand) so the caller picks the row of
 *  ITS own brand (ADR-013). */

import { catalogKey, normalizeCatalogCode } from '@/lib/business-rules'
import type { CatalogEntry } from '@/lib/purchase-plan'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** Batched descriptions → Map<catalogKey, description> for resolveDymmsaDescription. */
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
    // Degrade to "no catalog" (curated/empty): saving must not fail because the catalog went quiet.
    if (error) console.warn('fetchCatalogDescriptionMap error (ignored):', error)
    return new Map()
  }

  return new Map(data.map((row) => [catalogKey(row.code, row.brand), row.description]))
}

/** Variant with STD for the planner (ADR-018); on failure an empty map keeps the plan alive. */
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
