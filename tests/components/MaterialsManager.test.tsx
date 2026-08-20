/**
 * MaterialsManager (issue #71): control del catálogo de presentaciones que se
 * arma solo — listar por tipo, alta manual validada y borrado con confirmación.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { MaterialsManager } from '@/components/materials/MaterialsManager'
import type { MaterialPresentation } from '@/types/database'

const saveMut = vi.hoisted(() => vi.fn())
const deleteMut = vi.hoisted(() => vi.fn())
const presentationsData = vi.hoisted(() => ({
  current: { presentations: [] as MaterialPresentation[] },
}))

vi.mock('@/hooks/useCutPlan', () => ({
  useMaterialPresentations: () => ({ data: presentationsData.current, isLoading: false, error: null }),
  useSavePresentation: () => ({ mutateAsync: saveMut, isPending: false }),
  useDeletePresentation: () => ({ mutateAsync: deleteMut, isPending: false }),
}))

const TUBE: MaterialPresentation = {
  id: 'm1', material_type: 'tube', diameter_mm: 30, thickness_mm: null,
  width_mm: null, length_mm: 6000, last_used_at: '2026-08-15T00:00:00Z', created_at: '',
}
const PLATE: MaterialPresentation = {
  id: 'm2', material_type: 'plate', diameter_mm: null, thickness_mm: 10,
  width_mm: 450, length_mm: 400, last_used_at: '2026-08-10T00:00:00Z', created_at: '',
}

describe('MaterialsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    presentationsData.current = { presentations: [TUBE, PLATE] }
  })

  test('separa tubos y placas con sus medidas formateadas', () => {
    renderWithProviders(<MaterialsManager />)
    expect(screen.getByText('Barras de tubo (1)')).toBeInTheDocument()
    expect(screen.getByText('Hojas de placa (1)')).toBeInTheDocument()
    expect(screen.getByText('Ø30 mm')).toBeInTheDocument()
    expect(screen.getByText('6 m')).toBeInTheDocument()
    expect(screen.getByText('450 mm × 400 mm')).toBeInTheDocument()
  })

  test('alta manual de barra: deshabilitado hasta que ambas medidas son válidas', async () => {
    saveMut.mockResolvedValue({})
    const user = userEvent.setup()
    renderWithProviders(<MaterialsManager />)

    const addTube = screen.getByRole('button', { name: /agregar barra/i })
    expect(addTube).toBeDisabled()

    await user.type(screen.getByLabelText('Diámetro del tubo (mm)'), '25')
    expect(addTube).toBeDisabled()
    await user.type(screen.getByLabelText('Largo de la barra (mm)'), '3000')
    expect(addTube).toBeEnabled()

    await user.click(addTube)
    expect(saveMut).toHaveBeenCalledWith({ material_type: 'tube', diameter_mm: 25, length_mm: 3000 })
  })

  test('alta manual de hoja exige espesor, ancho y largo', async () => {
    saveMut.mockResolvedValue({})
    const user = userEvent.setup()
    renderWithProviders(<MaterialsManager />)

    await user.type(screen.getByLabelText('Espesor de la placa (mm)'), '5')
    await user.type(screen.getByLabelText('Ancho de la hoja (mm)'), '300')
    const addPlate = screen.getByRole('button', { name: /agregar hoja/i })
    expect(addPlate).toBeDisabled()
    await user.type(screen.getByLabelText('Largo de la hoja (mm)'), '600')

    await user.click(addPlate)
    expect(saveMut).toHaveBeenCalledWith({
      material_type: 'plate', thickness_mm: 5, width_mm: 300, length_mm: 600,
    })
  })

  test('eliminar pide confirmación y manda el id correcto', async () => {
    deleteMut.mockResolvedValue({})
    const user = userEvent.setup()
    renderWithProviders(<MaterialsManager />)

    await user.click(screen.getByRole('button', { name: /Eliminar barra Ø30/ }))
    expect(screen.getByText('¿Eliminar esta medida?')).toBeInTheDocument()
    // El texto del dialog describe la medida para no borrar a ciegas.
    expect(screen.getByText(/barra Ø30 mm × 6 m/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^eliminar$/i }))
    expect(deleteMut).toHaveBeenCalledWith('m1')
  })

  test('cancelar el dialog no borra nada', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MaterialsManager />)

    await user.click(screen.getByRole('button', { name: /Eliminar hoja de 10 mm/ }))
    await user.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(deleteMut).not.toHaveBeenCalled()
  })

  test('estado vacío por tipo', () => {
    presentationsData.current = { presentations: [TUBE] }
    renderWithProviders(<MaterialsManager />)
    expect(screen.getByText('Sin hojas registradas.')).toBeInTheDocument()
  })
})
