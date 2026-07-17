import { describe, test, expect } from 'vitest'
import {
  GENERAL_SECTION,
  NO_FILTERS,
  hasActiveFilters,
  deriveItemSections,
  listSections,
  listBrands,
  matchesFilters,
  computeVisibleItemIds,
} from '@/lib/approval-filters'

type Item = {
  id: string
  item_type: 'product' | 'separator'
  section_label: string | null
  brand: string | null
}

function product(id: string, brand: string | null = 'URREA'): Item {
  return { id, item_type: 'product', section_label: null, brand }
}
function separator(label: string | null): Item {
  return { id: `sep-${label}`, item_type: 'separator', section_label: label, brand: null }
}

describe('deriveItemSections', () => {
  test('ítems antes del primer separador caen en General', () => {
    const items = [product('a'), product('b'), separator('Obra Norte'), product('c')]
    const map = deriveItemSections(items)
    expect(map.get('a')).toBe(GENERAL_SECTION)
    expect(map.get('b')).toBe(GENERAL_SECTION)
    expect(map.get('c')).toBe('Obra Norte')
  })

  test('múltiples secciones se asignan por el último separador', () => {
    const items = [
      separator('Sección 1'), product('a'),
      separator('Sección 2'), product('b'), product('c'),
    ]
    const map = deriveItemSections(items)
    expect(map.get('a')).toBe('Sección 1')
    expect(map.get('b')).toBe('Sección 2')
    expect(map.get('c')).toBe('Sección 2')
  })

  test('separador con label vacío abre sección General', () => {
    const items = [separator('  '), product('a')]
    expect(deriveItemSections(items).get('a')).toBe(GENERAL_SECTION)
  })
})

describe('listSections', () => {
  test('secciones en orden con ≥1 ítem, incluye General si aplica', () => {
    const items = [
      product('a'),
      separator('Obra Norte'), product('b'),
      separator('Obra Sur'), product('c'),
    ]
    expect(listSections(items)).toEqual([GENERAL_SECTION, 'Obra Norte', 'Obra Sur'])
  })

  test('una sección sin ítems (separador seguido de otro) no se lista', () => {
    const items = [separator('Vacía'), separator('Con ítems'), product('a')]
    expect(listSections(items)).toEqual(['Con ítems'])
  })
})

describe('listBrands', () => {
  test('marcas únicas, sin vacías, ordenadas', () => {
    const items = [product('a', 'URREA'), product('b', 'SURTEK'), product('c', 'URREA'), product('d', null), product('e', '  ')]
    expect(listBrands(items)).toEqual(['SURTEK', 'URREA'])
  })
})

describe('matchesFilters', () => {
  test('sin filtros pasa todo', () => {
    expect(matchesFilters(product('a', 'URREA'), 'Obra Norte', NO_FILTERS)).toBe(true)
  })
  test('filtro de marca', () => {
    expect(matchesFilters(product('a', 'URREA'), 'X', { brand: 'URREA', section: 'all' })).toBe(true)
    expect(matchesFilters(product('a', 'SURTEK'), 'X', { brand: 'URREA', section: 'all' })).toBe(false)
  })
  test('filtro de sección', () => {
    expect(matchesFilters(product('a'), 'Obra Norte', { brand: 'all', section: 'Obra Norte' })).toBe(true)
    expect(matchesFilters(product('a'), 'Obra Sur', { brand: 'all', section: 'Obra Norte' })).toBe(false)
  })
  test('ambos filtros son AND', () => {
    const f = { brand: 'URREA', section: 'Obra Norte' }
    expect(matchesFilters(product('a', 'URREA'), 'Obra Norte', f)).toBe(true)
    expect(matchesFilters(product('a', 'URREA'), 'Obra Sur', f)).toBe(false)
    expect(matchesFilters(product('a', 'SURTEK'), 'Obra Norte', f)).toBe(false)
  })
})

describe('computeVisibleItemIds', () => {
  const items = [
    separator('Obra Norte'), product('a', 'URREA'), product('b', 'SURTEK'),
    separator('Obra Sur'), product('c', 'URREA'),
  ]

  test('sin filtros: todos los productos visibles, separadores fuera', () => {
    const visible = computeVisibleItemIds(items, NO_FILTERS)
    expect([...visible].sort()).toEqual(['a', 'b', 'c'])
  })

  test('filtro de marca reduce el set', () => {
    const visible = computeVisibleItemIds(items, { brand: 'URREA', section: 'all' })
    expect([...visible].sort()).toEqual(['a', 'c'])
  })

  test('marca + sección combinadas', () => {
    const visible = computeVisibleItemIds(items, { brand: 'URREA', section: 'Obra Norte' })
    expect([...visible]).toEqual(['a'])
  })
})

describe('hasActiveFilters', () => {
  test('detecta filtro activo', () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false)
    expect(hasActiveFilters({ brand: 'URREA', section: 'all' })).toBe(true)
    expect(hasActiveFilters({ brand: 'all', section: 'Obra Norte' })).toBe(true)
  })
})
