/**
 * Vistas guiadas del flujo de venta (issue #74, ADR-024): anti-drift de los
 * anclajes `data-tour` del cotizador (sus DOS momentos: upload y editor) y de
 * la lista de cotizaciones. El tour del detalle vive en QuotationDetail.test.tsx.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores, seedQuotationItems } from './helpers/stores'
import { quotationItemRow } from './helpers/fixtures'
import QuoterPage from '@/app/dashboard/quoter/page'
import QuotationsPage from '@/app/dashboard/quotations/page'
import { QUOTER_TOUR } from '@/lib/tours/quoter'
import { QUOTATIONS_LIST_TOUR } from '@/lib/tours/quotations-list'

const driveMock = vi.hoisted(() => vi.fn())
const driverMock = vi.hoisted(() => vi.fn(() => ({ drive: driveMock })))

vi.mock('driver.js', () => ({ driver: driverMock }))
vi.mock('driver.js/dist/driver.css', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/hooks/useQuotes', () => ({
  useLookupEtms: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useQuotations', () => ({
  useSaveQuotation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  // QuotationsTable lo llama a nivel de componente aunque no haya filas.
  useDeleteQuotation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useQuotations: () => ({
    data: { data: [], count: 0, page: 1, pageSize: 20, totalPages: 1 },
    isLoading: false,
  }),
  useQuotationStats: () => ({
    data: { draft: 1, sent_for_approval: 2, approved: 3, rejected: 0, converted_to_order: 1 },
  }),
  ApiError: class ApiError extends Error {},
}))
vi.mock('@/hooks/useUrreaCatalog', () => ({
  useCatalogDescription: () => ({ data: null }),
}))

describe('Vista guiada — cotizador', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  test('anti-drift: el paso de upload existe con el borrador vacío', () => {
    renderWithProviders(<QuoterPage />)
    expect(document.querySelector('[data-tour="quoter-upload"]')).not.toBeNull()
  })

  test('anti-drift: los pasos del editor existen con borrador sembrado', () => {
    // Con items en el store, la página arranca directo en el editor.
    seedQuotationItems([
      quotationItemRow({ etm: 'A', model_code: 'MC1', quantity: 2, unit_price: 100, description: 'x' }),
    ])
    renderWithProviders(<QuoterPage />)

    for (const step of QUOTER_TOUR.filter((s) => !s.selector.includes('quoter-upload'))) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('el botón arranca driver.js solo con los bloques del momento actual', async () => {
    seedQuotationItems([
      quotationItemRow({ etm: 'A', model_code: 'MC1', quantity: 2, unit_price: 100, description: 'x' }),
    ])
    const user = userEvent.setup()
    renderWithProviders(<QuoterPage />)

    await user.click(screen.getByRole('button', { name: /vista guiada/i }))

    expect(driveMock).toHaveBeenCalledOnce()
    const config = driverMock.mock.calls[0][0]
    // 6 pasos menos el de upload (no visible en el editor) = 5.
    expect(config.steps).toHaveLength(QUOTER_TOUR.length - 1)
  })
})

describe('Vista guiada — lista de cotizaciones', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  test('anti-drift: todos los selectores del tour existen', () => {
    renderWithProviders(<QuotationsPage />)
    for (const step of QUOTATIONS_LIST_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('el botón arranca driver.js con los 4 bloques resueltos', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuotationsPage />)

    await user.click(screen.getByRole('button', { name: /vista guiada/i }))

    expect(driveMock).toHaveBeenCalledOnce()
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(QUOTATIONS_LIST_TOUR.length)
  })
})
