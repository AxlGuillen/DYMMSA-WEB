/**
 * Vistas guiadas de almacén y catálogos (issue #74, ADR-024): anti-drift de
 * los anclajes `data-tour` de inventario, base de datos ETM y catálogo URREA.
 * Las tablas/forms hijos se mockean a null: los anclajes viven en las páginas
 * y así el test no arrastra los hooks de cada tabla.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import InventoryPage from '@/app/dashboard/inventory/page'
import DbPage from '@/app/dashboard/db/page'
import UrreaCatalogPage from '@/app/dashboard/urrea/catalog/page'
import { INVENTORY_TOUR } from '@/lib/tours/inventory'
import { ETM_DB_TOUR } from '@/lib/tours/etm-db'
import { URREA_CATALOG_TOUR } from '@/lib/tours/urrea-catalog'

const driveMock = vi.hoisted(() => vi.fn())
const driverMock = vi.hoisted(() => vi.fn(() => ({ drive: driveMock })))

vi.mock('driver.js', () => ({ driver: driverMock }))
vi.mock('driver.js/dist/driver.css', () => ({}))

vi.mock('@/components/inventory/InventoryTable', () => ({
  InventoryTable: () => null,
  INVENTORY_COLUMNS: [],
}))
vi.mock('@/components/inventory/InventoryForm', () => ({ InventoryForm: () => null }))
vi.mock('@/components/inventory/InventoryImporter', () => ({ InventoryImporter: () => null }))
vi.mock('@/components/db/ProductsTable', () => ({
  ProductsTable: () => null,
  PRODUCTS_COLUMNS: [],
}))
vi.mock('@/components/db/ProductForm', () => ({ ProductForm: () => null }))
vi.mock('@/components/db/ExcelImporter', () => ({ ExcelImporter: () => null }))
vi.mock('@/components/urrea-catalog/CatalogTable', () => ({
  CatalogTable: () => null,
  CATALOG_COLUMNS: [],
}))
vi.mock('@/components/urrea-catalog/CatalogForm', () => ({ CatalogForm: () => null }))
vi.mock('@/components/urrea-catalog/CatalogImporter', () => ({ CatalogImporter: () => null }))

vi.mock('@/hooks/useInventory', () => ({
  // La página también importa las constantes del filtro por marca (#53);
  // sin ellas el mock del módulo las deja undefined y revienta el render.
  ALL_BRANDS: '__all__',
  NO_BRAND: '__none__',
  useInventory: () => ({
    data: { data: [], count: 0, page: 1, pageSize: 20, totalPages: 1 },
    isLoading: false,
  }),
  useInventoryStats: () => ({
    data: { total: 10, in_stock: 5, low_stock: 3, sin_stock: 2, brands: [] },
  }),
}))
vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => ({
    data: { data: [], count: 0, totalPages: 1 },
    isLoading: false,
  }),
}))
vi.mock('@/hooks/useUrreaCatalog', () => ({
  useUrreaCatalog: () => ({
    data: { data: [], count: 0, totalPages: 1 },
    isLoading: false,
  }),
  useUrreaCatalogStats: () => ({
    data: { total: 3, brands: [{ brand: 'URREA', count: 3 }] },
  }),
}))

const CASES = [
  { name: 'inventario', Page: InventoryPage, tour: INVENTORY_TOUR },
  { name: 'base de datos ETM', Page: DbPage, tour: ETM_DB_TOUR },
  { name: 'catálogo URREA', Page: UrreaCatalogPage, tour: URREA_CATALOG_TOUR },
] as const

describe.each(CASES)('Vista guiada — $name', ({ Page, tour }) => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  test('anti-drift: todos los selectores del tour existen', () => {
    renderWithProviders(<Page />)
    for (const step of tour) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('el botón arranca driver.js con todos los bloques resueltos', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Page />)

    await user.click(screen.getByRole('button', { name: /vista guiada/i }))

    expect(driveMock).toHaveBeenCalledOnce()
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(tour.length)
  })
})
