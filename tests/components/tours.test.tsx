/**
 * Vista guiada del dashboard (issue #52, ADR-024): anti-drift de los anclajes
 * `data-tour` del sidebar + panel de inicio, y arranque vía TourButton. El
 * tour de corte se prueba en CutPlanner.test.tsx y el de aprobación en
 * ApprovalClient.test.tsx — cada uno junto a su página.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { Sidebar } from '@/components/layout/Sidebar'
import { DashboardMetrics } from '@/components/dashboard/DashboardMetrics'
import { TourButton } from '@/components/tours/TourButton'
import { DASHBOARD_TOUR } from '@/lib/tours/dashboard'

const driveMock = vi.hoisted(() => vi.fn())
const driverMock = vi.hoisted(() => vi.fn(() => ({ drive: driveMock })))

vi.mock('driver.js', () => ({ driver: driverMock }))
vi.mock('driver.js/dist/driver.css', () => ({}))
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as Record<string, string>)} />
  },
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'test@dymmsa.local' }, signOut: vi.fn() }),
}))
vi.mock('@/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: undefined, isLoading: true }),
}))

function renderDashboard() {
  return renderWithProviders(
    <>
      <Sidebar />
      <TourButton tour="dashboard" />
      <DashboardMetrics />
    </>,
  )
}

describe('Vista guiada — dashboard y sidebar', () => {
  beforeEach(() => vi.clearAllMocks())

  test('anti-drift: todos los selectores del tour existen en sidebar + inicio', () => {
    renderDashboard()
    for (const step of DASHBOARD_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('el botón Vista guiada arranca driver.js con los 7 bloques resueltos', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await user.click(screen.getByRole('button', { name: /vista guiada/i }))

    expect(driveMock).toHaveBeenCalledOnce()
    const config = driverMock.mock.calls[0][0]
    expect(config.steps.map((s: { element: Element }) => s.element)).toEqual(
      DASHBOARD_TOUR.map((s) => document.querySelector(s.selector)),
    )
    // Los pasos del sidebar se posicionan a la derecha (el menú vive pegado
    // al borde izquierdo).
    expect(config.steps[0].popover.side).toBe('right')
  })
})
