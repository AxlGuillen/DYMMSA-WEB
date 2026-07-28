/**
 * Acciones de fila (issue #55): editar y eliminar al PRIMER click.
 *
 * Antes vivían dentro de un menú "···" que además solo aparecía al hover, así
 * que lo que se protege aquí es justamente que los botones existan por sí solos
 * y disparen su handler sin pasos intermedios.
 */

import { describe, test, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { RowActions } from '@/components/RowActions'

const setup = () => {
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  renderWithProviders(<RowActions what="ETM-1" onEdit={onEdit} onDelete={onDelete} />)
  return { onEdit, onDelete }
}

describe('RowActions', () => {
  test('editar y eliminar están visibles sin abrir ningún menú', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Editar ETM-1' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Eliminar ETM-1' })).toBeVisible()
    // La regresión a evitar: que vuelvan a esconderse tras un "···".
    expect(screen.queryByRole('button', { name: /more|opciones|menú/i })).toBeNull()
  })

  test('un solo click dispara editar', async () => {
    const { onEdit, onDelete } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Editar ETM-1' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()
  })

  test('un solo click dispara eliminar', async () => {
    const { onEdit, onDelete } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar ETM-1' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onEdit).not.toHaveBeenCalled()
  })

  test('sin `what` las etiquetas siguen siendo accesibles', () => {
    renderWithProviders(<RowActions onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Editar' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeVisible()
  })
})
