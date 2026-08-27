/**
 * Auto-learn: cada cotización/orden guardada enriquece etm_products.
 * Reglas en CLAUDE.md; cálculos puros + una función impura que los usa.
 */

import { isProductItem } from '@/lib/business-rules'
import type { createClient } from '@/lib/supabase/server'
import type { QuotationItemRow } from '@/types/database'

/** Resultado del auto-learn (distinto del AutoLearnResult legacy de types/database.ts). */
export interface QuotationAutoLearnResult {
  added: number
  updated: number
  skipped: number
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

// ─── Tipos internos ────────────────────────────────────────────────────

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

// ─── Funciones puras ───────────────────────────────────────────────────

/** Elegible: producto con etm y (model_code o description) — o un is_sold explícito solo. */
export function isEligibleForAutoLearn(item: QuotationItemRow): item is EligibleItem {
  return (
    isProductItem(item) &&
    !!item.etm &&
    (!!item.model_code || !!item.description || item.is_sold != null || !!item.dymmsa_description)
  )
}

/** Campos del INSERT nuevo. Regla: brand default URREA SOLO si hay model_code. */
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
    // Curada DYMMSA CRUDA de la UI — nunca la resuelta con catálogo: la oficial
    // de URREA no debe copiarse a etm_products (jerarquía en lectura, ADR-013).
    dymmsa_description: item.dymmsa_description || null,
    model_code:     item.model_code     || '',
    price:          item.unit_price     ?? 0,
    brand:          item.brand || (item.model_code ? 'URREA' : null),
    is_sold:        item.is_sold ?? null,
  }
}

/** Merge del UPDATE: solo campos no vacíos que cambiaron — jamás pisa con vacío. */
export function mergeEtmFields(
  existing: ExistingEtm,
  incoming: EligibleItem
): { updates: Record<string, unknown>; hasChanges: boolean } {
  const updates: Record<string, unknown> = {}

  if (incoming.description    && incoming.description    !== existing.description)
    updates.description = incoming.description
  if (incoming.description_es && incoming.description_es !== existing.description_es)
    updates.description_es = incoming.description_es
  // Curada cruda: solo valor no vacío, nunca pisa con vacío (misma regla que el resto).
  if (incoming.dymmsa_description && incoming.dymmsa_description !== existing.dymmsa_description)
    updates.dymmsa_description = incoming.dymmsa_description
  if (incoming.model_code     && incoming.model_code     !== existing.model_code)
    updates.model_code = incoming.model_code
  if (incoming.brand          && incoming.brand          !== existing.brand)
    updates.brand = incoming.brand
  if (incoming.unit_price != null && incoming.unit_price !== existing.price)
    updates.price = incoming.unit_price
  // is_sold es tri-estado: solo propagamos un valor EXPLÍCITO (true/false).
  // Un `null` entrante = "sin definir" → nunca pisa lo que ya haya en el catálogo.
  if (incoming.is_sold != null && incoming.is_sold !== existing.is_sold)
    updates.is_sold = incoming.is_sold

  return { updates, hasChanges: Object.keys(updates).length > 0 }
}

// ─── Función impura (orchestración) ────────────────────────────────────

/** Inserta o actualiza cada ítem elegible; retorna { added, updated, skipped }. */
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
      // ── INSERT ─────────────────────────────────────────────────────
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
      // ── UPDATE ─────────────────────────────────────────────────────
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
