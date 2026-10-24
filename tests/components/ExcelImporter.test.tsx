/** ExcelImporter (#157): a rejected file keeps its row list in the dialog, it does not fade in a toast. */

import { describe, test, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { ExcelImporter } from '@/components/db/ExcelImporter'
import { ApiError } from '@/lib/fetch-json'

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }))

vi.mock('@/hooks/useProducts', () => ({
  useImportProducts: () => ({ mutateAsync, isPending: false }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const FILE = new File(['x'], 'productos.xlsx', {
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
})

describe('ExcelImporter', () => {
  test('el error de un archivo rechazado queda en la ventana, un problema por renglón', async () => {
    mutateAsync.mockRejectedValueOnce(
      new ApiError('No se importó nada: corrige el archivo.\nFila 3 (ETM E2): el precio no puede ser negativo («-5»).', 'VALIDATION'),
    )
    const user = userEvent.setup()
    renderWithProviders(<ExcelImporter open onOpenChange={vi.fn()} />)

    await user.upload(screen.getByLabelText('Seleccionar archivo Excel'), FILE)
    await user.click(screen.getByRole('button', { name: 'Importar' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Fila 3 (ETM E2): el precio no puede ser negativo')
    expect(alert.className).toContain('whitespace-pre-line')
  })

  test('elegir otro archivo limpia el error anterior', async () => {
    mutateAsync.mockRejectedValueOnce(new ApiError('No se importó nada: corrige el archivo.', 'VALIDATION'))
    const user = userEvent.setup()
    renderWithProviders(<ExcelImporter open onOpenChange={vi.fn()} />)

    await user.upload(screen.getByLabelText('Seleccionar archivo Excel'), FILE)
    await user.click(screen.getByRole('button', { name: 'Importar' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.upload(screen.getByLabelText('Seleccionar archivo Excel'), new File(['y'], 'otro.xlsx'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('éxito: cierra la ventana', async () => {
    mutateAsync.mockResolvedValueOnce({ imported: 2, updated: 1, skipped: 0, errors: 0, total: 3 })
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<ExcelImporter open onOpenChange={onOpenChange} />)

    await user.upload(screen.getByLabelText('Seleccionar archivo Excel'), FILE)
    await user.click(screen.getByRole('button', { name: 'Importar' }))
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
