/** Public approval filters (#24). An item's section is the last separator before it; "General" before the first. */

import { isSeparator } from '@/lib/business-rules'

type FilterableItem = {
  id: string
  item_type: 'product' | 'separator'
  section_label: string | null
  brand: string | null
}

/** Synthetic section for items that precede the first separator. */
export const GENERAL_SECTION = 'General'

export interface ApprovalFilters {
  /** Exact brand or 'all'. */
  brand: string
  /** Exact section label or 'all'. */
  section: string
}

export const NO_FILTERS: ApprovalFilters = { brand: 'all', section: 'all' }

export function hasActiveFilters(filters: ApprovalFilters): boolean {
  return filters.brand !== 'all' || filters.section !== 'all'
}

/** itemId → section. An empty separator label still opens a section (GENERAL) so no item is lost. */
export function deriveItemSections<T extends FilterableItem>(items: T[]): Map<string, string> {
  const map = new Map<string, string>()
  let current = GENERAL_SECTION
  for (const item of items) {
    if (isSeparator(item)) {
      current = item.section_label?.trim() || GENERAL_SECTION
      continue
    }
    map.set(item.id, current)
  }
  return map
}

/** Sections in order of appearance holding at least one item. */
export function listSections<T extends FilterableItem>(items: T[]): string[] {
  const sectionsMap = deriveItemSections(items)
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const item of items) {
    if (isSeparator(item)) continue
    const section = sectionsMap.get(item.id)
    if (section && !seen.has(section)) {
      seen.add(section)
      ordered.push(section)
    }
  }
  return ordered
}

/** Unique non-empty brands, sorted. */
export function listBrands<T extends { brand: string | null }>(items: T[]): string[] {
  const brands = new Set<string>()
  for (const item of items) {
    const brand = item.brand?.trim()
    if (brand) brands.add(brand)
  }
  return [...brands].sort((a, b) => a.localeCompare(b, 'es'))
}

export function matchesFilters(
  item: { brand: string | null },
  sectionLabel: string,
  filters: ApprovalFilters,
): boolean {
  if (filters.brand !== 'all' && (item.brand?.trim() || '') !== filters.brand) return false
  if (filters.section !== 'all' && sectionLabel !== filters.section) return false
  return true
}

/** Visible ids; callers render a separator only if its section has items. */
export function computeVisibleItemIds<T extends FilterableItem>(
  items: T[],
  filters: ApprovalFilters,
): Set<string> {
  const sectionsMap = deriveItemSections(items)
  const visible = new Set<string>()
  for (const item of items) {
    if (isSeparator(item)) continue
    const section = sectionsMap.get(item.id) ?? GENERAL_SECTION
    if (matchesFilters(item, section, filters)) visible.add(item.id)
  }
  return visible
}
