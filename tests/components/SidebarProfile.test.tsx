/** Sidebar footer (#122): avatar, name and role link to Mi perfil instead of the bare email. */

import { describe, test, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './helpers/render'
import { Sidebar } from '@/components/layout/Sidebar'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-tania', email: 'tania@dymmsa.mx' }, signOut: vi.fn() }),
}))
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 'u-tania', display_name: 'Tania Cruz', role: 'member', avatar_url: null },
    isAdmin: false,
  }),
}))

describe('Sidebar — pie con el perfil', () => {
  test('muestra iniciales, nombre y rol y liga a Mi perfil', () => {
    renderWithProviders(<Sidebar />)
    const link = screen.getByRole('link', { name: /Tania Cruz/ })
    expect(link).toHaveAttribute('href', '/dashboard/profile')
    expect(link).toHaveTextContent('TC')
    expect(link).toHaveTextContent('Miembro')
    expect(screen.queryByText('tania@dymmsa.mx')).not.toBeInTheDocument()
  })
})
