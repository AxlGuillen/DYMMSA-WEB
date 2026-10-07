/** Novedades tabs (2026-10-05): Actividad, the technical log, only exists for administrators. */

import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChangelogTabs } from '@/components/changelog/ChangelogTabs'

describe('ChangelogTabs', () => {
  test('un miembro solo ve Novedades', () => {
    render(<ChangelogTabs active="novedades" isAdmin={false} />)
    expect(screen.getByRole('link', { name: /Novedades/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Actividad/ })).not.toBeInTheDocument()
  })

  test('el admin ve las dos', () => {
    render(<ChangelogTabs active="actividad" isAdmin />)
    expect(screen.getByRole('link', { name: /Actividad/ })).toHaveAttribute('href', '/dashboard/changelog/actividad')
  })
})
