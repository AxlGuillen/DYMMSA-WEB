/** Quoter pre-flight validation. Duplicate ETMs are NOT validated on purpose: a product may repeat
 *  across sections. */

import type { QuotationItemRow } from '@/types/database'
import { isProductItem, isNotSold } from '@/lib/business-rules'

export type ValidationField = 'quantity' | 'unit_price' | 'etm' | 'model_code'
export type ValidationSeverity = 'error' | 'warning'

export interface QuotationValidationIssue {
  /** `_id` of the offending row, for scroll + highlight. */
  itemId: string
  /** May be null when the rule is precisely "missing ETM". */
  etm: string | null
  field: ValidationField
  /** error blocks saving; warning only informs. */
  severity: ValidationSeverity
  /** Display-ready message (Spanish). */
  message: string
}

export interface ValidateOptions {
  /** Validate only items with `is_approved === true` (create-order). */
  onlyApproved?: boolean
}

export function validateQuotationItems(
  items: QuotationItemRow[],
  options: ValidateOptions = {},
): QuotationValidationIssue[] {
  const issues: QuotationValidationIssue[] = []

  for (const item of items) {
    if (!isProductItem(item)) continue
    // "Not sold" items are exempt from price/quantity/ETM: they must not block saving.
    if (isNotSold(item)) continue
    if (options.onlyApproved && item.is_approved !== true) continue

    const tag = item.etm || '(sin ETM)'

    if (item.quantity == null || item.quantity <= 0) {
      issues.push({
        itemId: item._id,
        etm: item.etm || null,
        field: 'quantity',
        severity: 'error',
        message: `ETM "${tag}": la cantidad debe ser mayor a 0.`,
      })
    }

    // A null price is allowed: "no price yet".
    if (item.unit_price != null && item.unit_price < 0) {
      issues.push({
        itemId: item._id,
        etm: item.etm || null,
        field: 'unit_price',
        severity: 'error',
        message: `ETM "${tag}": el precio no puede ser negativo.`,
      })
    }

    if (!item.etm) {
      issues.push({
        itemId: item._id,
        etm: null,
        field: 'etm',
        severity: 'error',
        message: 'Hay un producto sin ETM. Asígnale uno o elimínalo.',
      })
    }

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

/** Only the 'error' issues — the ones that block saving. */
export function getBlockingIssues(items: QuotationItemRow[], options: ValidateOptions = {}) {
  return validateQuotationItems(items, options).filter((i) => i.severity === 'error')
}

/** Ids of items with at least one error, for UI highlighting. */
export function getErrorItemIds(items: QuotationItemRow[], options: ValidateOptions = {}): Set<string> {
  return new Set(getBlockingIssues(items, options).map((i) => i.itemId))
}

// Header fields warn with toast + highlight instead of disabling the button (#26).

export type HeaderField = 'name' | 'customer'

/** Required header fields that are empty after trim. */
export function getMissingHeaderFields(name: string, customerName: string): HeaderField[] {
  const missing: HeaderField[] = []
  if (!name.trim()) missing.push('name')
  if (!customerName.trim()) missing.push('customer')
  return missing
}

/** Toast message for the missing header fields; '' when none is. */
export function headerFieldsMessage(missing: HeaderField[]): string {
  const name = missing.includes('name')
  const customer = missing.includes('customer')
  if (name && customer) return 'Faltan el nombre de la cotización y el nombre del cliente.'
  if (name) return 'Falta el nombre de la cotización.'
  if (customer) return 'Falta el nombre del cliente.'
  return ''
}

/** True when there is no product item at all (separators do not count). */
export function hasNoProducts(items: QuotationItemRow[]): boolean {
  return !items.some(isProductItem)
}
