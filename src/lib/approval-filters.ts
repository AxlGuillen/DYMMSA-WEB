/**
 * Filtros de la aprobación pública (#24): por marca y por sección — la sección
 * de un ítem es el último separador que lo precede; antes del primero, "General".
 */

import { isSeparator } from '@/lib/business-rules'

type FilterableItem = {
  id: string
  item_type: 'product' | 'separator'
  section_label: string | null
  brand: string | null
}

/** Etiqueta de la sección sintética para los ítems previos al primer separador. */
export const GENERAL_SECTION = 'General'

export interface ApprovalFilters {
  /** marca exacta o 'all'. */
  brand: string
  /** etiqueta de sección exacta o 'all'. */
  section: string
}

export const NO_FILTERS: ApprovalFilters = { brand: 'all', section: 'all' }

export function hasActiveFilters(filters: ApprovalFilters): boolean {
  return filters.brand !== 'all' || filters.section !== 'all'
}

/** itemId → sección; un separador con label vacío igual abre sección (GENERAL) para no perder ítems. */
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

/** Secciones en orden de aparición que tienen ≥1 ítem (para el Select de proyecto). */
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

/** Marcas únicas no vacías, ordenadas alfabéticamente (para el Select de marca). */
export function listBrands<T extends { brand: string | null }>(items: T[]): string[] {
  const brands = new Set<string>()
  for (const item of items) {
    const brand = item.brand?.trim()
    if (brand) brands.add(brand)
  }
  return [...brands].sort((a, b) => a.localeCompare(b, 'es'))
}

/** ¿El ítem (con su sección) pasa los filtros activos? */
export function matchesFilters(
  item: { brand: string | null },
  sectionLabel: string,
  filters: ApprovalFilters,
): boolean {
  if (filters.brand !== 'all' && (item.brand?.trim() || '') !== filters.brand) return false
  if (filters.section !== 'all' && sectionLabel !== filters.section) return false
  return true
}

/** Ids visibles bajo los filtros; el caller muestra un separador solo si su sección tiene ítems. */
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
