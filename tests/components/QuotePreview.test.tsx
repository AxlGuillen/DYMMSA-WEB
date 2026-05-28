import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuotePreview } from '@/components/quoter/QuotePreview'
import { resetStores } from './helpers/stores'
import { etmProduct } from './helpers/fixtures'

function setup(props: Partial<Parameters<typeof QuotePreview>[0]> = {}) {
  const onDownload = vi.fn()
  const onReset = vi.fn()
  const defaults = {
    filename: 'cliente.xlsx',
    totalRequested: 5,
    matchedProducts: [
      etmProduct({ etm: 'E1', price: 100 }),
      etmProduct({ etm: 'E2', price: 50 }),
    ],
    unmatchedEtms: ['E9', 'E10'],
    onDownload,
    onReset,
  }
  render(<QuotePreview {...defaults} {...props} />)
  return { onDownload, onReset }
}

describe('QuotePreview', () => {
  beforeEach(() => resetStores())

  test('calcula el % de match y el valor total', () => {
    setup({ totalRequested: 4 }) // 2 matched / 4 = 50%
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('$150.00')).toBeInTheDocument() // 100 + 50
  })

  test('color del badge según el % (≥80 verde)', () => {
    setup({ totalRequested: 2 }) // 2/2 = 100%
    const badge = screen.getByText('100%')
    expect(badge.className).toContain('text-green-600')
  })

  test('color del badge rojo cuando < 50%', () => {
    setup({ totalRequested: 10 }) // 2/10 = 20%
    expect(screen.getByText('20%').className).toContain('text-red-600')
  })

  test('expande la lista de ETMs no encontrados al hacer click', async () => {
    const user = userEvent.setup()
    setup()
    // Colapsado: los badges de ETMs aún no están visibles.
    expect(screen.queryByText('E9')).not.toBeInTheDocument()
    await user.click(screen.getByText('2 ETMs no encontrados'))
    expect(screen.getByText('E9')).toBeInTheDocument()
    expect(screen.getByText('E10')).toBeInTheDocument()
  })

  test('copiar ETMs no encontrados usa el portapapeles', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    setup()
    await user.click(screen.getByText('2 ETMs no encontrados'))
    await user.click(screen.getByRole('button', { name: /Copiar/ }))
    expect(writeText).toHaveBeenCalledWith('E9\nE10')
  })

  test('Descargar deshabilitado sin productos; onReset/onDownload se invocan', async () => {
    const user = userEvent.setup()
    const { onReset } = setup({ matchedProducts: [] })
    const download = screen.getByRole('button', { name: /Descargar/ })
    expect(download).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Subir otro archivo/ }))
    expect(onReset).toHaveBeenCalledOnce()
  })

  test('Descargar invoca onDownload cuando hay productos', async () => {
    const user = userEvent.setup()
    const { onDownload } = setup()
    await user.click(screen.getByRole('button', { name: /Descargar/ }))
    expect(onDownload).toHaveBeenCalledOnce()
  })

  test('no muestra la sección de no encontrados cuando la lista está vacía', () => {
    setup({ unmatchedEtms: [] })
    expect(screen.queryByText(/ETMs no encontrados/)).not.toBeInTheDocument()
  })

  test('renderiza la tabla de productos encontrados', () => {
    setup()
    // Validamos por contenido dentro de la tabla de productos.
    expect(within(screen.getByRole('table')).getByText('E1')).toBeInTheDocument()
  })
})
