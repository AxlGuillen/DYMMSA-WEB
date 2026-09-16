/** HoursView (#93): a member sees only their own week, with no selector and no edit controls. */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './helpers/render'
import { HoursView } from '@/components/hours/HoursView'
import { buildWeekView } from '@/lib/timesheet'

const state = vi.hoisted(() => ({
  role: 'member' as 'member' | 'admin',
  lastParams: null as unknown,
}))

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 'me', display_name: 'Tania', role: state.role, clock_employee_id: 5 },
    isAdmin: state.role === 'admin',
    isLoading: false,
  }),
  useProfiles: (enabled: boolean) => ({
    data: enabled
      ? [
          { id: 'me', display_name: 'Tania', role: state.role, clock_employee_id: 5 },
          { id: 'u-diego', display_name: 'Diego', role: 'admin', clock_employee_id: 1 },
        ]
      : undefined,
  }),
}))

vi.mock('@/hooks/useTimeEntries', () => ({
  useTimeEntries: (params: unknown) => {
    state.lastParams = params
    const week = buildWeekView(
      [{
        id: 'te-1', user_id: 'me', work_date: '2026-08-31', source_clock_in: '10:06', clock_in: '10:06', clock_out: '18:11',
        note: null, source: 'import', edited_by: null, edited_at: null, original: null, created_at: '', updated_at: '',
      }],
      '2026-08-31',
    )
    return { data: { user: 'me', from: week.start, to: week.end, entries: [], week }, isLoading: false }
  },
  useCreateTimeEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTimeEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTimeEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('HoursView', () => {
  beforeEach(() => { state.role = 'member'; state.lastParams = null })

  test('member: sin selector de empleado, sin ✎ y sin user en la consulta', () => {
    renderWithProviders(<HoursView />)
    expect(screen.queryByLabelText('Empleado')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Editar checada')).not.toBeInTheDocument()
    expect(screen.getByTestId('week-total')).toHaveTextContent('08:05')
    expect((state.lastParams as { user: string | null }).user).toBeNull()
  })

  test('admin: selector de empleado y controles de edición', () => {
    state.role = 'admin'
    renderWithProviders(<HoursView />)
    expect(screen.getByLabelText('Empleado')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Editar checada')).toHaveLength(1)
    expect((state.lastParams as { user: string | null }).user).toBe('me')
  })

  test('el stepper cambia de semana y ofrece volver a la actual', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    renderWithProviders(<HoursView />)
    expect(screen.queryByRole('button', { name: 'Esta semana' })).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Semana anterior'))
    expect(screen.getByRole('button', { name: 'Esta semana' })).toBeInTheDocument()
    const params = state.lastParams as { from: string; to: string }
    expect(params.from < params.to).toBe(true)
  })
})
