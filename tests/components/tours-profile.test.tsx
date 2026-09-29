/** Mi perfil tour (#122, ADR-024): anti-drift over the three blocks of the page. */

import { describe, test, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import ProfilePage from '@/app/dashboard/profile/page'
import { PROFILE_TOUR } from '@/lib/tours/profile'

const driveMock = vi.hoisted(() => vi.fn())
const driverMock = vi.hoisted(() => vi.fn(() => ({ drive: driveMock })))

vi.mock('driver.js', () => ({ driver: driverMock }))
vi.mock('driver.js/dist/driver.css', () => ({}))
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: {
      id: 'u-tania', display_name: 'Tania', role: 'member', clock_employee_id: 5, shift: 'part_time',
      nss: null, avatar_path: null, avatar_url: null, email: 'tania@dymmsa.mx',
    },
    isLoading: false,
    isAdmin: false,
  }),
  useUpdateOwnProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadAvatar: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveAvatar: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('Vista guiada — Mi perfil', () => {
  test('anti-drift: los 3 selectores existen y el botón arranca con todos', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ProfilePage />)
    for (const step of PROFILE_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
    await user.click(screen.getByRole('button', { name: /vista guiada/i }))
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(PROFILE_TOUR.length)
  })
})
