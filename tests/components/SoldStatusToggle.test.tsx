/**
 * Toggle de "¿lo vendemos?" (issue #55). `is_sold` es TRI-ESTADO
 * (null / true / false) y solo los valores explícitos pisan el catálogo vía
 * auto-learn: lo que se protege aquí es que se pueda volver a `null` haciendo
 * click en el botón ya activo — si no, una marca por error sería irreversible
 * desde la tabla.
 */

import { describe, test, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { SoldStatusToggle } from '@/components/quotations/SoldStatusToggle'

const setup = (value: boolean | null) => {
  const onChange = vi.fn()
  renderWithProviders(<SoldStatusToggle value={value} onChange={onChange} />)
  return { onChange }
}

// Por posición: las etiquetas cambian con el estado ("Marcar…" / "Quitar…") y
// "…no se vende" contiene a "…se vende", así que un regex sería ambiguo.
const siButton = () => screen.getAllByRole('button')[0]
const noButton = () => screen.getAllByRole('button')[1]

describe('SoldStatusToggle', () => {
  test('sin definir: un click marca "se vende"', async () => {
    const { onChange } = setup(null)
    await userEvent.click(siButton())
    expect(onChange).toHaveBeenCalledWith(true)
  })

  test('sin definir: un click marca "no se vende"', async () => {
    const { onChange } = setup(null)
    await userEvent.click(noButton())
    expect(onChange).toHaveBeenCalledWith(false)
  })

  test('click en el botón ACTIVO regresa a sin definir (null)', async () => {
    const { onChange } = setup(true)
    await userEvent.click(siButton())
    expect(onChange).toHaveBeenCalledWith(null)
  })

  test('click en el "no" activo también regresa a null', async () => {
    const { onChange } = setup(false)
    await userEvent.click(noButton())
    expect(onChange).toHaveBeenCalledWith(null)
  })

  test('cambiar de true a false en un solo click', async () => {
    const { onChange } = setup(true)
    await userEvent.click(noButton())
    expect(onChange).toHaveBeenCalledWith(false)
  })

  test('aria-pressed refleja el estado (lectores de pantalla)', () => {
    setup(true)
    expect(siButton()).toHaveAttribute('aria-pressed', 'true')
    expect(noButton()).toHaveAttribute('aria-pressed', 'false')
  })

  test('deshabilitado no dispara cambios', async () => {
    const onChange = vi.fn()
    renderWithProviders(<SoldStatusToggle value={null} onChange={onChange} disabled />)
    await userEvent.click(siButton()).catch(() => {})
    expect(onChange).not.toHaveBeenCalled()
  })
})
