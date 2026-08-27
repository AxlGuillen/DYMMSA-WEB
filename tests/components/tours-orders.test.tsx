/**
 * Vista guiada de la lista de órdenes (issue #74, ADR-024): anti-drift de los
 * anclajes `data-tour` y arranque vía TourButton. El tour del detalle vive en
 * OrderDetail.test.tsx, junto a su componente.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import OrdersPage from '@/app/dashboard/orders/page'
import { ORDERS_LIST_TOUR } from '@/lib/tours/orders-list'

const driveMock = vi.hoisted(() => vi.fn())
const driverMock = vi.hoisted(() => vi.fn(() => ({ drive: driveMock })))

vi.mock('driver.js', () => ({ driver: driverMock }))
vi.mock('driver.js/dist/driver.css', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/hooks/useOrders', () => ({
  ORDERS_KEY: ['orders'],
  // OrdersTable lo llama a nivel de componente aunque no haya filas.
  useDeleteOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOrders: () => ({
    data: { data: [], count: 0, page: 1, pageSize: 20, totalPages: 1 },
    isLoading: false,
  }),
  useOrderStats: () => ({
    data: { ordered: 2, received: 1, delivered: 0, completed: 4, cancelled: 1 },
  }),
}))

describe('Vista guiada — lista de órdenes', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  test('anti-drift: todos los selectores del tour existen', () => {
    renderWithProviders(<OrdersPage />)
    for (const step of ORDERS_LIST_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('el botón arranca driver.js con los 4 bloques resueltos', async () => {
    const user = userEvent.setup()
    renderWithProviders(<OrdersPage />)

    await user.click(screen.getByRole('button', { name: /vista guiada/i }))

    expect(driveMock).toHaveBeenCalledOnce()
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(ORDERS_LIST_TOUR.length)
  })
})
