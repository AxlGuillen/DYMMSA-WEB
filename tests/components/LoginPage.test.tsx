/** Login (ADR-023 #8): every destination opens with one full page load — never push + refresh. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import LoginPage from '@/app/login/page'

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn().mockResolvedValue({ error: null }) }))

vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithPassword: signIn } }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const assign = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('location', { assign, search: '', origin: 'http://localhost:3000' })
})
afterEach(() => vi.unstubAllGlobals())

async function login(search: string) {
  window.location.search = search
  const user = userEvent.setup()
  renderWithProviders(<LoginPage />)
  await user.type(screen.getByLabelText('Correo electrónico'), 'axl@dymmsa.mx')
  await user.type(screen.getByLabelText('Contraseña', { selector: 'input' }), 'secreta')
  await user.click(screen.getByRole('button', { name: /iniciar sesión/i }))
}

describe('LoginPage — destino después de iniciar sesión', () => {
  test('el consentimiento OAuth se abre con una sola carga completa', async () => {
    const next = '/oauth/consent?authorization_id=abc123'
    await login(`?next=${encodeURIComponent(next)}`)
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith(next)
  })

  test('otra ruta interna también', async () => {
    await login(`?next=${encodeURIComponent('/dashboard/orders')}`)
    expect(assign).toHaveBeenCalledWith('/dashboard/orders')
  })

  test('sin next va al dashboard', async () => {
    await login('')
    expect(assign).toHaveBeenCalledWith('/dashboard')
  })

  test('un next externo cae al dashboard', async () => {
    await login(`?next=${encodeURIComponent('//evil.com/oauth/x')}`)
    expect(assign).toHaveBeenCalledWith('/dashboard')
  })

  test('con error de credenciales no navega', async () => {
    signIn.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })
    await login('')
    expect(assign).not.toHaveBeenCalled()
  })
})
