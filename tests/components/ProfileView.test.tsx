/** Mi perfil (#122): NSS masked until revealed, only changed fields are sent, and the photo is cropped before upload. */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import { useDiscreteModeStore } from '@/stores/discreteModeStore'
import { ProfileView } from '@/components/profile/ProfileView'
import type { OwnProfile } from '@/types/database'

const { updateOwn, uploadAvatar, removeAvatar, cropAvatar, toastError } = vi.hoisted(() => ({
  updateOwn: vi.fn().mockResolvedValue({}),
  uploadAvatar: vi.fn().mockResolvedValue({ avatar_url: 'x' }),
  removeAvatar: vi.fn().mockResolvedValue({ avatar_url: null }),
  cropAvatar: vi.fn(),
  toastError: vi.fn(),
}))

let profile: OwnProfile

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile, isLoading: false, isAdmin: profile.role === 'admin' }),
  useUpdateOwnProfile: () => ({ mutateAsync: updateOwn, isPending: false }),
  useUploadAvatar: () => ({ mutateAsync: uploadAvatar, isPending: false }),
  useRemoveAvatar: () => ({ mutateAsync: removeAvatar, isPending: false }),
}))
vi.mock('@/lib/image-compress', () => ({ cropAvatar }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }))

const base: OwnProfile = {
  id: 'u-tania',
  display_name: 'Tania Cruz',
  role: 'member',
  clock_employee_id: 5,
  shift: 'part_time',
  nss: '12345678903',
  avatar_path: null,
  avatar_url: null,
  email: 'tania@dymmsa.mx',
}

beforeEach(() => {
  resetStores()
  vi.clearAllMocks()
  profile = { ...base }
})

describe('ProfileView', () => {
  test('el NSS se ve oculto y se revela con el ojo', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ProfileView />)
    const input = screen.getByLabelText('Número de Seguridad Social (NSS)')
    expect(input).toHaveValue('•••••••8903')
    expect(input).toHaveAttribute('readonly')

    await user.click(screen.getByRole('button', { name: 'Mostrar NSS' }))
    expect(input).toHaveValue('12345678903')
    expect(input).not.toHaveAttribute('readonly')
  })

  test('en modo discreto el NSS no se puede revelar', () => {
    useDiscreteModeStore.setState({ isDiscreteMode: true })
    renderWithProviders(<ProfileView />)
    expect(screen.getByRole('button', { name: 'Mostrar NSS' })).toBeDisabled()
  })

  test('guarda solo lo que cambió', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ProfileView />)
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()

    const name = screen.getByLabelText('Nombre')
    await user.clear(name)
    await user.type(name, 'Tania C.')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(updateOwn).toHaveBeenCalledWith({ display_name: 'Tania C.' })
  })

  test('un NSS inválido avisa y no se envía; uno válido se manda normalizado', async () => {
    profile = { ...base, nss: null }
    const user = userEvent.setup()
    renderWithProviders(<ProfileView />)
    const input = screen.getByLabelText('Número de Seguridad Social (NSS)')

    await user.type(input, '1234 5678 904')
    expect(screen.getByText('El NSS no es válido: revisa que no falte o sobre un dígito')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(updateOwn).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, '1234 5678 903')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(updateOwn).toHaveBeenCalledWith({ nss: '12345678903' })
  })

  test('un NSS guardado que no pasa el verificador no impide cambiar el nombre (review PR #126)', async () => {
    profile = { ...base, nss: '12345678904' }
    const user = userEvent.setup()
    renderWithProviders(<ProfileView />)
    const name = screen.getByLabelText('Nombre')
    await user.clear(name)
    await user.type(name, 'Tania C.')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(updateOwn).toHaveBeenCalledWith({ display_name: 'Tania C.' })
  })

  test('los datos del admin se muestran de solo lectura', () => {
    renderWithProviders(<ProfileView />)
    expect(screen.getByText('tania@dymmsa.mx')).toBeInTheDocument()
    expect(screen.getByText('Miembro')).toBeInTheDocument()
    expect(screen.getByText('Medio tiempo · 4 h')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  test('la foto se recorta antes de subir; un tipo no permitido ni se procesa', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const cropped = new Blob(['webp'], { type: 'image/webp' })
    cropAvatar.mockResolvedValue(cropped)
    renderWithProviders(<ProfileView />)
    const picker = screen.getByLabelText('Elegir foto')

    await user.upload(picker, new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }))
    expect(toastError).toHaveBeenCalledWith('El archivo debe ser JPG, PNG o WebP')
    expect(cropAvatar).not.toHaveBeenCalled()

    const photo = new File(['jpg'], 'yo.jpg', { type: 'image/jpeg' })
    await user.upload(picker, photo)
    expect(cropAvatar).toHaveBeenCalledWith(photo)
    expect(uploadAvatar).toHaveBeenCalledWith(cropped)
  })

  test('con foto aparece Quitar y la imagen reemplaza a las iniciales', async () => {
    profile = { ...base, avatar_url: 'https://cdn/avatars/u-tania/a.webp' }
    const user = userEvent.setup()
    renderWithProviders(<ProfileView />)
    expect(screen.getByRole('img', { name: 'Tania Cruz' })).toHaveAttribute('src', 'https://cdn/avatars/u-tania/a.webp')
    await user.click(screen.getByRole('button', { name: 'Quitar' }))
    expect(removeAvatar).toHaveBeenCalled()
  })
})
