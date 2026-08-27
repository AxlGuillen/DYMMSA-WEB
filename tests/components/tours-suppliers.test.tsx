/**
 * Vista guiada de proveedores (issue #74, ADR-024): anti-drift de los
 * anclajes `data-tour`. La tabla y los forms se mockean a null — los anclajes
 * viven en la página. El tour de tareas se prueba en TasksPage.test.tsx.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import SuppliersPage from '@/app/dashboard/proveedores/page'
import { SUPPLIERS_TOUR } from '@/lib/tours/suppliers'

const driveMock = vi.hoisted(() => vi.fn())
const driverMock = vi.hoisted(() => vi.fn(() => ({ drive: driveMock })))

vi.mock('driver.js', () => ({ driver: driverMock }))
vi.mock('driver.js/dist/driver.css', () => ({}))

vi.mock('@/components/suppliers/SuppliersTable', () => ({
  SuppliersTable: () => null,
  SUPPLIERS_COLUMNS: [],
}))
vi.mock('@/components/suppliers/SupplierForm', () => ({ SupplierForm: () => null }))
vi.mock('@/components/suppliers/BrandsManager', () => ({ BrandsManager: () => null }))

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({
    data: { data: [], count: 0, page: 1, pageSize: 20, totalPages: 1 },
    isLoading: false,
  }),
  useBrands: () => ({ data: [{ id: 'b1', name: 'TRUPER' }] }),
}))

describe('Vista guiada — proveedores', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  test('anti-drift: todos los selectores del tour existen', () => {
    renderWithProviders(<SuppliersPage />)
    for (const step of SUPPLIERS_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('el botón arranca driver.js con los 3 bloques resueltos', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SuppliersPage />)

    await user.click(screen.getByRole('button', { name: /vista guiada/i }))

    expect(driveMock).toHaveBeenCalledOnce()
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(SUPPLIERS_TOUR.length)
  })
})
