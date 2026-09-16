/** RichText: the four inline marks used by changelogs — Novedades used to print `**asterisks**` raw. */

import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RichText } from '@/components/changelog/RichText'

describe('RichText', () => {
  test('liga #123 a su tarea y deja el resto del texto intacto', () => {
    const { container } = render(<RichText text="Corrige el filtro (#123) del inventario" />)
    const link = screen.getByRole('link', { name: '#123' })
    expect(link).toHaveAttribute('href', '/dashboard/tasks/123')
    expect(container.textContent).toBe('Corrige el filtro (#123) del inventario')
  })

  test('los backticks se vuelven <code> y las negritas <strong>', () => {
    const { container } = render(<RichText text="**Migración**: corre `bun run check`" />)
    expect(container.querySelector('strong')?.textContent).toBe('Migración')
    expect(container.querySelector('code')?.textContent).toBe('bun run check')
    // Neither asterisks nor backticks survive as text.
    expect(container.textContent).toBe('Migración: corre bun run check')
  })

  test('el código dentro de una negrita se renderiza (no quedan backticks sueltos)', () => {
    const { container } = render(<RichText text="**Migración `20260902043910`**" />)
    const strong = container.querySelector('strong')
    expect(strong?.querySelector('code')?.textContent).toBe('20260902043910')
    expect(container.textContent).toBe('Migración 20260902043910')
  })

  test('el wikilink de la bóveda se muestra por su nombre, sin ruta ni corchetes', () => {
    const { container } = render(
      <RichText text="Ver [[04-Decisiones-Tecnicas/ADR-001-Separadores]]." />,
    )
    expect(container.textContent).toBe('Ver ADR-001-Separadores.')
  })

  test('texto sin marcas pasa sin tocarse', () => {
    const { container } = render(<RichText text="Se agregó el filtro por marca." />)
    expect(container.textContent).toBe('Se agregó el filtro por marca.')
    expect(container.querySelector('code')).toBeNull()
  })
})
