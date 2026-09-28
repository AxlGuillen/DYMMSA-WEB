/** Hours tours (#120, ADR-024): anti-drift on Mi semana (admin vs member) and Equipo. */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import HoursPage from '@/app/dashboard/hours/page'
import HoursTeamPage from '@/app/dashboard/hours/team/page'
import { HOURS_TOUR } from '@/lib/tours/hours'
import { TEAM_TOUR } from '@/lib/tours/team'
import { buildWeekView } from '@/lib/timesheet'

const driveMock = vi.hoisted(() => vi.fn())
const driverMock = vi.hoisted(() => vi.fn(() => ({ drive: driveMock })))
const state = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member' }))

vi.mock('driver.js', () => ({ driver: driverMock }))
vi.mock('driver.js/dist/driver.css', () => ({}))
vi.mock('@/components/hours/WeekBars', () => ({ default: () => null }))
vi.mock('@/components/hours/TrendBars', () => ({ default: () => null }))

const ME = { id: 'me', display_name: 'Tania', role: 'member', clock_employee_id: 5, shift: 'part_time', created_at: '', updated_at: '' }
const DIEGO = { id: 'u-diego', display_name: 'Diego', role: 'admin', clock_employee_id: 1, shift: 'full_time', created_at: '', updated_at: '' }

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { ...ME, role: state.role }, isAdmin: state.role === 'admin', isLoading: false }),
  useProfiles: (enabled = true) => ({ data: enabled ? [{ ...ME, role: state.role }, DIEGO] : undefined, isLoading: false }),
  useUpdateProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useTimeEntries', () => ({
  useTimeEntries: () => {
    const week = buildWeekView([], '2026-08-31')
    return { data: { user: 'me', from: week.start, to: week.end, entries: [], week }, isLoading: false, isError: false }
  },
  useCreateTimeEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTimeEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTimeEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('Vista guiada — Mi semana', () => {
  beforeEach(() => { vi.clearAllMocks(); state.role = 'admin' })

  test('anti-drift (admin): los 5 selectores existen', () => {
    renderWithProviders(<HoursPage />)
    for (const step of HOURS_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('el botón arranca con 5 bloques como admin y 4 como member (el selector se filtra solo)', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<HoursPage />)
    await user.click(screen.getByRole('button', { name: /vista guiada/i }))
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(HOURS_TOUR.length)
    unmount()

    state.role = 'member'
    vi.clearAllMocks()
    renderWithProviders(<HoursPage />)
    expect(document.querySelector('[data-tour="hrs-employee"]')).toBeNull()
    await user.click(screen.getByRole('button', { name: /vista guiada/i }))
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(HOURS_TOUR.length - 1)
  })
})

describe('Vista guiada — Equipo', () => {
  beforeEach(() => { vi.clearAllMocks(); state.role = 'admin' })

  test('anti-drift: los 2 selectores existen y el botón arranca con ambos', async () => {
    const user = userEvent.setup()
    renderWithProviders(<HoursTeamPage />)
    for (const step of TEAM_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
    await user.click(screen.getByRole('button', { name: /vista guiada/i }))
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(TEAM_TOUR.length)
  })

  test('member: la tabla no existe, el tour solo tiene el encabezado', async () => {
    state.role = 'member'
    const user = userEvent.setup()
    renderWithProviders(<HoursTeamPage />)
    await user.click(screen.getByRole('button', { name: /vista guiada/i }))
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(1)
  })
})
