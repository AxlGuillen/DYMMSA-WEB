/**
 * Auto-learn de catálogo ETM.
 *
 * Cuando se guarda una cotización u orden, los ítems con `etm` se usan para
 * crecer/enriquecer el catálogo `etm_products`. Reglas críticas del CLAUDE.md:
 *
 * - Solo procesa ítems de tipo producto (separadores excluidos)
 * - Solo procesa ítems con `etm` Y (model_code o description)
 * - Al INSERTAR: `brand` default es 'URREA' **solo si** hay model_code
 * - Al ACTUALIZAR: solo se sobreescriben campos no vacíos que cambiaron
 *
 * Estructura: cálculos puros + función impura que los usa.
 */

import { isProductItem } from '@/lib/business-rules'
import type { createClient } from '@/lib/supabase/server'
import type { QuotationItemRow } from '@/types/database'

/**
 * Resultado del auto-learn de cotizaciones/órdenes.
 * Distinto del `AutoLearnResult` en `types/database.ts` que pertenece al
 * endpoint legacy `/api/orders/auto-learn` (insert-only).
 */
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
  model_code: string
  price: number
  brand: string
}

type EligibleItem = QuotationItemRow & { etm: string }

// ─── Funciones puras ───────────────────────────────────────────────────

/**
 * Decide si un ítem es elegible para auto-learn.
 * Reglas: tipo producto, tiene etm, y al menos model_code o description.
 */
export function isEligibleForAutoLearn(item: QuotationItemRow): item is EligibleItem {
  return (
    isProductItem(item) &&
    !!item.etm &&
    (!!item.model_code || !!item.description)
  )
}

/**
 * Calcula los campos para un INSERT nuevo en `etm_products`.
 *
 * REGLA CRÍTICA: brand default 'URREA' solo si hay model_code.
 * Sin model_code, brand queda null (no se asume URREA).
 */
export function computeNewEtmFields(item: EligibleItem): {
  etm: string
  description: string
  description_es: string
  model_code: string
  price: number
  brand: string | null
} {
  return {
    etm:            item.etm,
    description:    item.description    || '',
    description_es: item.description_es || '',
    model_code:     item.model_code     || '',
    price:          item.unit_price     ?? 0,
    brand:          item.brand || (item.model_code ? 'URREA' : null),
  }
}

/**
 * Merge de campos para UPDATE de un ETM existente.
 * Solo retorna los campos NO VACÍOS que han cambiado.
 *
 * REGLA CRÍTICA: nunca sobreescribe con string vacío. Si el ítem no tiene
 * valor para un campo, ese campo queda intacto en la BD.
 */
export function mergeEtmFields(
  existing: ExistingEtm,
  incoming: EligibleItem
): { updates: Record<string, unknown>; hasChanges: boolean } {
  const updates: Record<string, unknown> = {}

  if (incoming.description    && incoming.description    !== existing.description)
    updates.description = incoming.description
  if (incoming.description_es && incoming.description_es !== existing.description_es)
    updates.description_es = incoming.description_es
  if (incoming.model_code     && incoming.model_code     !== existing.model_code)
    updates.model_code = incoming.model_code
  if (incoming.brand          && incoming.brand          !== existing.brand)
    updates.brand = incoming.brand
  if (incoming.unit_price != null && incoming.unit_price !== existing.price)
    updates.price = incoming.unit_price

  return { updates, hasChanges: Object.keys(updates).length > 0 }
}

// ─── Función impura (orchestración) ────────────────────────────────────

/**
 * Procesa auto-learn: para cada ítem elegible, INSERTA si no existe en
 * `etm_products` o ACTUALIZA si existe y cambió algún campo.
 *
 * Retorna métricas `{ added, updated, skipped }`.
 */
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
    .select('id, etm, description, description_es, model_code, price, brand')
    .in('etm', etmCodes)

  const existingMap = new Map<string, ExistingEtm>(
    (existingProducts ?? []).map((p) => [p.etm, p as ExistingEtm])
  )

  for (const item of eligible) {
    const existing = existingMap.get(item.etm)

    if (!existing) {
      // ── INSERT ─────────────────────────────────────────────────────
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
