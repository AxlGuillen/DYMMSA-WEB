/** TeamTable: shift (#101), avatar and NSS (#122) per person; the editor sends them with the profile. */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import { useDiscreteModeStore } from '@/stores/discreteModeStore'
import { TeamTable } from '@/components/hours/TeamTable'

const { updateAsync } = vi.hoisted(() => ({ updateAsync: vi.fn().mockResolvedValue({}) }))

vi.mock('@/hooks/useProfile', () => ({
  useProfiles: () => ({
    data: [
      { id: 'u-tania', display_name: 'Tania', role: 'member', clock_employee_id: 5, shift: 'part_time', nss: '12345678903', avatar_path: 'u-tania/a.webp', avatar_url: 'https://cdn/avatars/u-tania/a.webp', created_at: '', updated_at: '' },
      { id: 'u-diego', display_name: 'Diego', role: 'admin', clock_employee_id: 1, shift: null, nss: null, avatar_path: null, avatar_url: null, created_at: '', updated_at: '' },
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

describe('TeamTable — avatar y NSS (#122)', () => {
  beforeEach(() => { updateAsync.mockClear(); resetStores() })

  test('foto o iniciales por persona y el NSS oculto salvo los últimos 4', () => {
    const { container } = renderWithProviders(<TeamTable />)
    expect(container.querySelector('img[src="https://cdn/avatars/u-tania/a.webp"]')).not.toBeNull()
    expect(screen.getByText('D')).toBeInTheDocument()
    expect(screen.getByText('•••••••8903')).toBeInTheDocument()
    expect(screen.queryByText('12345678903')).not.toBeInTheDocument()
    expect(screen.getByText('sin capturar')).toBeInTheDocument()
  })

  test('el admin captura el NSS normalizado y un NSS inválido no se envía', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TeamTable />)
    await user.click(screen.getByRole('button', { name: 'Editar Diego' }))
    await user.type(screen.getByLabelText('NSS'), '1234-5678-904')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(updateAsync).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('NSS'))
    await user.type(screen.getByLabelText('NSS'), '1234-5678-903')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 'u-diego',
      updates: { display_name: 'Diego', role: 'admin', clock_employee_id: 1, shift: null, nss: '12345678903' },
    })
  })

  test('en el diálogo el NSS guardado sale enmascarado y el modo discreto bloquea el ojo (review PR #126)', async () => {
    const user = userEvent.setup()
    useDiscreteModeStore.setState({ isDiscreteMode: true })
    renderWithProviders(<TeamTable />)
    await user.click(screen.getByRole('button', { name: 'Editar Tania' }))
    expect(screen.getByLabelText('NSS')).toHaveValue('•••••••••••')
    expect(screen.getByRole('button', { name: 'Mostrar NSS' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(updateAsync.mock.calls[0][0].updates).not.toHaveProperty('nss')
  })
})
