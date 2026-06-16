/**
 * Validación pre-flight de ítems de cotización: atrapa los casos conocidos
 * ANTES del request para dar feedback inmediato y señalar el ítem ofensor
 * por su `_id` (para resaltarlo en la UI) y por su ETM (para el toast).
 *
 * Reglas implementadas:
 *   - quantity == null || quantity <= 0  → error (mata save y create-order)
 *   - unit_price != null && unit_price < 0 → error
 *   - !etm → error (sin ETM no podemos identificarlo después)
 *   - !model_code → warning (no bloquea, informa)
 *
 * No se valida ETMs duplicados dentro de la misma cotización: es
 * comportamiento intencional (el mismo producto puede aparecer en distintas
 * secciones).
 *
 * Separadores se ignoran (no aplican ninguna regla de producto).
 */

import type { QuotationItemRow } from '@/types/database'
import { isProductItem } from '@/lib/business-rules'

export type ValidationField = 'quantity' | 'unit_price' | 'etm' | 'model_code'
export type ValidationSeverity = 'error' | 'warning'

export interface QuotationValidationIssue {
  /** `_id` de la fila ofensora (para hacer scroll y resaltar en la UI). */
  itemId: string
  /** ETM del ítem ofensor (puede ser null si la regla es justamente "sin ETM"). */
  etm: string | null
  /** Campo que viola la regla. */
  field: ValidationField
  /** error bloquea el guardado; warning solo informa. */
  severity: ValidationSeverity
  /** Mensaje en español listo para mostrar. */
  message: string
}

export interface ValidateOptions {
  /** Si es true, solo valida ítems con `is_approved === true` (uso de create-order). */
  onlyApproved?: boolean
}

export function validateQuotationItems(
  items: QuotationItemRow[],
  options: ValidateOptions = {},
): QuotationValidationIssue[] {
  const issues: QuotationValidationIssue[] = []

  for (const item of items) {
    if (!isProductItem(item)) continue
    if (options.onlyApproved && item.is_approved !== true) continue

    const tag = item.etm || '(sin ETM)'

    // 1. Cantidad debe ser > 0
    if (item.quantity == null || item.quantity <= 0) {
      issues.push({
        itemId: item._id,
        etm: item.etm || null,
        field: 'quantity',
        severity: 'error',
        message: `ETM "${tag}": la cantidad debe ser mayor a 0.`,
      })
    }

    // 2. Precio no negativo (null se permite — significa "sin precio aún")
    if (item.unit_price != null && item.unit_price < 0) {
      issues.push({
        itemId: item._id,
        etm: item.etm || null,
        field: 'unit_price',
        severity: 'error',
        message: `ETM "${tag}": el precio no puede ser negativo.`,
      })
    }

    // 3. ETM requerido — sin ETM no podemos identificar el producto
    if (!item.etm) {
      issues.push({
        itemId: item._id,
        etm: null,
        field: 'etm',
        severity: 'error',
        message: 'Hay un producto sin ETM. Asígnale uno o elimínalo.',
      })
    }

    // 4. model_code → warning (no bloquea)
    if (!item.model_code) {
      issues.push({
        itemId: item._id,
        etm: item.etm || null,
        field: 'model_code',
        severity: 'warning',
        message: `ETM "${tag}": sin código de modelo (no se usará en auto-learn).`,
      })
    }
  }

  return issues
}

/** Devuelve solo los issues de severidad 'error' (los que bloquean el guardado). */
export function getBlockingIssues(items: QuotationItemRow[], options: ValidateOptions = {}) {
  return validateQuotationItems(items, options).filter((i) => i.severity === 'error')
}

/** Set de IDs de items con al menos un error (para resaltar en la UI). */
export function getErrorItemIds(items: QuotationItemRow[], options: ValidateOptions = {}): Set<string> {
  return new Set(getBlockingIssues(items, options).map((i) => i.itemId))
}
