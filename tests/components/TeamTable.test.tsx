/** TeamTable (#101): the shift shows per person and the editor sends it with the profile. */

import { describe, test, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { TeamTable } from '@/components/hours/TeamTable'

const { updateAsync } = vi.hoisted(() => ({ updateAsync: vi.fn().mockResolvedValue({}) }))

vi.mock('@/hooks/useProfile', () => ({
  useProfiles: () => ({
    data: [
      { id: 'u-tania', display_name: 'Tania', role: 'member', clock_employee_id: 5, shift: 'part_time', created_at: '', updated_at: '' },
      { id: 'u-diego', display_name: 'Diego', role: 'admin', clock_employee_id: 1, shift: null, created_at: '', updated_at: '' },
    ],
    isLoading: false,
  }),
  useUpdateProfile: () => ({ mutateAsync: updateAsync, isPending: false }),
}))

describe('TeamTable — jornada', () => {
  test('la columna muestra la jornada o "sin jornada"', () => {
    renderWithProviders(<TeamTable />)
    expect(screen.getByText('Medio tiempo · 4 h')).toBeInTheDocument()
    expect(screen.getByText('sin jornada')).toBeInTheDocument()
  })

  test('el editor manda la jornada elegida junto con el resto del perfil', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TeamTable />)
    await user.click(screen.getByLabelText('Editar Diego'))
    await user.click(screen.getByLabelText('Jornada'))
    await user.click(await screen.findByRole('option', { name: 'Tiempo completo · 8 h' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 'u-diego',
      updates: { display_name: 'Diego', role: 'admin', clock_employee_id: 1, shift: 'full_time' },
    })
  })
})
