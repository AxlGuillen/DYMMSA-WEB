/** Excused days panel (meeting 2026-10-01): the admin adds a holiday or an authorized exit and removes it. */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import { ExcusedDaysPanel } from '@/components/hours/ExcusedDaysPanel'
import { todayInMexico } from '@/lib/format'

const { createDay, deleteDay } = vi.hoisted(() => ({
  createDay: vi.fn().mockResolvedValue({}),
  deleteDay: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/hooks/useProfile', () => ({
  useProfiles: () => ({ data: [{ id: 'u-tania', display_name: 'Tania' }] }),
}))
vi.mock('@/hooks/useExcusedDays', () => ({
  useExcusedDays: () => ({
    data: [
      { id: 'x1', work_date: '2026-09-16', user_id: null, kind: 'holiday', note: 'Independencia', created_by: null, created_at: '' },
      { id: 'x2', work_date: '2026-09-25', user_id: 'u-tania', kind: 'early_release', note: null, created_by: null, created_at: '' },
    ],
    isLoading: false,
  }),
  useCreateExcusedDay: () => ({ mutateAsync: createDay, isPending: false }),
  useDeleteExcusedDay: () => ({ mutateAsync: deleteDay, isPending: false }),
}))

beforeEach(() => {
  resetStores()
  vi.clearAllMocks()
})

describe('ExcusedDaysPanel', () => {
  test('lista cada día con su tipo y para quién', () => {
    renderWithProviders(<ExcusedDaysPanel />)
    const holiday = screen.getByText('Independencia').closest('tr')
    expect(holiday).toHaveTextContent('Día feriado')
    expect(holiday).toHaveTextContent('Todo el equipo')
    const exit = screen.getByText('Salida autorizada', { selector: 'td' }).closest('tr')
    expect(exit).toHaveTextContent('Tania')
  })

  test('agrega un feriado para todo el equipo con la fecha de hoy por default', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExcusedDaysPanel />)
    await user.type(screen.getByLabelText('Nota'), 'Puente')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(createDay).toHaveBeenCalledWith({ work_date: todayInMexico(), kind: 'holiday', user_id: null, note: 'Puente' })
  })

  test('quitar un día llama al borrado con su id', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExcusedDaysPanel />)
    const [first] = screen.getAllByRole('button', { name: /^Quitar/ })
    await user.click(first)
    expect(deleteDay).toHaveBeenCalledWith('x1')
  })
})
