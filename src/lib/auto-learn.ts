/** Auto-learn: every saved quotation/order enriches etm_products (rules in CLAUDE.md). */

import { isProductItem } from '@/lib/business-rules'
import type { createClient } from '@/lib/supabase/server'
import type { QuotationItemRow } from '@/types/database'

/** Distinct from the legacy AutoLearnResult in types/database.ts. */
export interface QuotationAutoLearnResult {
  added: number
  updated: number
  skipped: number
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

type ExistingEtm = {
  etm: string
  description: string
  description_es: string
  dymmsa_description: string | null
  model_code: string
  price: number
  brand: string
  is_sold: boolean | null
}

type EligibleItem = QuotationItemRow & { etm: string }

/** Eligible: product with etm plus model_code/description — or an explicit is_sold alone. */
export function isEligibleForAutoLearn(item: QuotationItemRow): item is EligibleItem {
  return (
    isProductItem(item) &&
    !!item.etm &&
    (!!item.model_code || !!item.description || item.is_sold != null || !!item.dymmsa_description)
  )
}

/** INSERT fields. Brand defaults to URREA ONLY when a model_code exists. */
export function computeNewEtmFields(item: EligibleItem): {
  etm: string
  description: string
  description_es: string
  dymmsa_description: string | null
  model_code: string
  price: number
  brand: string | null
  is_sold: boolean | null
} {
  return {
    etm:            item.etm,
    description:    item.description    || '',
    description_es: item.description_es || '',
    // Raw curated value, never the catalog-resolved one: the official URREA
    // description must not be copied into etm_products (ADR-013).
    dymmsa_description: item.dymmsa_description || null,
    model_code:     item.model_code     || '',
    price:          item.unit_price     ?? 0,
    brand:          item.brand || (item.model_code ? 'URREA' : null),
    is_sold:        item.is_sold ?? null,
  }
}

/** UPDATE merge: only non-empty changed fields — never overwrites with empty. */
export function mergeEtmFields(
  existing: ExistingEtm,
  incoming: EligibleItem
): { updates: Record<string, unknown>; hasChanges: boolean } {
  const updates: Record<string, unknown> = {}

  if (incoming.description    && incoming.description    !== existing.description)
    updates.description = incoming.description
  if (incoming.description_es && incoming.description_es !== existing.description_es)
    updates.description_es = incoming.description_es
  // Raw curated value, only when non-empty — same rule as the rest.
  if (incoming.dymmsa_description && incoming.dymmsa_description !== existing.dymmsa_description)
    updates.dymmsa_description = incoming.dymmsa_description
  if (incoming.model_code     && incoming.model_code     !== existing.model_code)
    updates.model_code = incoming.model_code
  if (incoming.brand          && incoming.brand          !== existing.brand)
    updates.brand = incoming.brand
  if (incoming.unit_price != null && incoming.unit_price !== existing.price)
    updates.price = incoming.unit_price
  // Tri-state: only an EXPLICIT true/false propagates; an incoming `null`
  // ("undefined") must never overwrite the catalog.
  if (incoming.is_sold != null && incoming.is_sold !== existing.is_sold)
    updates.is_sold = incoming.is_sold

  return { updates, hasChanges: Object.keys(updates).length > 0 }
}

export async function processAutoLearn(
  supabase: SupabaseServerClient,
  userId: string,
  items: QuotationItemRow[]
): Promise<QuotationAutoLearnResult> {
  const result: QuotationAutoLearnResult = { added: 0, updated: 0, skipped: 0 }

  const eligible = items.filter(isEligibleForAutoLearn)
  if (eligible.length === 0) return result

  const etmCodes = eligible.map((i) => i.etm)
  const { data: existingProducts } = await supabase
    .from('etm_products')
    .select('id, etm, description, description_es, dymmsa_description, model_code, price, brand, is_sold')
    .in('etm', etmCodes)

  const existingMap = new Map<string, ExistingEtm>(
    (existingProducts ?? []).map((p) => [p.etm, p as ExistingEtm])
  )

  for (const item of eligible) {
    const existing = existingMap.get(item.etm)

    if (!existing) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- sequential DB writes (ordering / avoid inventory races)
      const { error } = await supabase
        .from('etm_products')
        .insert({ ...computeNewEtmFields(item), created_by: userId })

      if (error) {
        console.error('Auto-learn insert error:', error)
        result.skipped++
      } else {
        result.added++
      }
    } else {
      const { updates, hasChanges } = mergeEtmFields(existing, item)

      if (!hasChanges) {
        result.skipped++
        continue
      }

      const { error } = await supabase
        .from('etm_products')
        .update(updates)
        .eq('etm', item.etm)

      if (error) {
        console.error('Auto-learn update error:', error)
        result.skipped++
      } else {
        result.updated++
      }
    }
  }

  return result
}
