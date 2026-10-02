/** Login (ADR-023): an OAuth consent `next` gets one full page load, everything else the client router. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import LoginPage from '@/app/login/page'

const { push, refresh, signIn } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signIn: vi.fn().mockResolvedValue({ error: null }),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithPassword: signIn } }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const assign = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('location', { ...window.location, assign, search: '' })
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
  test('el consentimiento OAuth se abre con UNA carga completa, sin push ni refresh', async () => {
    const next = '/oauth/consent?authorization_id=abc123'
    await login(`?next=${encodeURIComponent(next)}`)
    expect(assign).toHaveBeenCalledWith(next)
    expect(push).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  test('cualquier otra ruta va por el router', async () => {
    await login(`?next=${encodeURIComponent('/dashboard/orders')}`)
    expect(push).toHaveBeenCalledWith('/dashboard/orders')
    expect(assign).not.toHaveBeenCalled()
  })

  test('sin next va al dashboard por el router', async () => {
    await login('')
    expect(push).toHaveBeenCalledWith('/dashboard')
    expect(refresh).toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  test('un next externo cae al dashboard', async () => {
    await login(`?next=${encodeURIComponent('//evil.com/oauth/x')}`)
    expect(push).toHaveBeenCalledWith('/dashboard')
    expect(assign).not.toHaveBeenCalled()
  })
})
