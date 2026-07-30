/**
 * CutPlanner (issue #59, Fases 3-4): necesidad neta de tubos y placas desde el
 * fixture, acomodo al capturar la presentación (barra / ancho de tira), payload
 * del guardado con AMBOS tipos, y los diagramas SVG en sus estados clave.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { CutPlanner } from '@/components/orders/CutPlanner'
import { CutBarDiagram } from '@/components/orders/CutBarDiagram'
import type { CutPlanResponse } from '@/hooks/useCutPlan'

const saveMut = vi.hoisted(() => vi.fn())
const presMut = vi.hoisted(() => vi.fn())
const settingsMut = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useCutPlan', () => ({
  useSaveCutPlan: () => ({ mutateAsync: saveMut, isPending: false }),
  useSavePresentation: () => ({ mutateAsync: presMut, isPending: false }),
}))
vi.mock('@/hooks/useSettings', () => ({
  useUpdateSettings: () => ({ mutateAsync: settingsMut, isPending: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const data = (): CutPlanResponse => ({
  order: { id: 'o1', name: 'Orden 1', customer_name: 'ACME', status: 'ordered' },
  pieces: [
    {
      id: 'p1', order_id: 'o1', material_type: 'tube',
      diameter_mm: 30, thickness_mm: null, width_mm: null, length_mm: 300,
      quantity: 4, requested_label: 'Botador 30', source_item_id: null,
      sort_order: 0, created_at: '', updated_at: '',
    },
    {
      id: 'pp', order_id: 'o1', material_type: 'plate',
      diameter_mm: null, thickness_mm: 5, width_mm: 200, length_mm: 300,
      quantity: 2, requested_label: 'Placa X', source_item_id: null,
      sort_order: 1, created_at: '', updated_at: '',
    },
  ],
  candidates: [
    {
      itemId: 'i9', etm: 'DY-9', description: 'Botador 25', quantity: 2,
      cutKind: 'tube', diameterMm: 25, thicknessMm: null, widthMm: null, lengthMm: 250,
    },
  ],
  presentations: [
    {
      id: 'm1', material_type: 'tube', diameter_mm: 30, thickness_mm: null,
      width_mm: null, length_mm: 6000, last_used_at: '', created_at: '',
    },
  ],
  marginMm: 20,
})

describe('CutPlanner', () => {
  beforeEach(() => vi.clearAllMocks())

  test('necesidad neta: tubos con margen por pieza; placas con área y ancho mínimo', () => {
    renderWithProviders(<CutPlanner data={data()} />)
    // Tubos: 4 × (300 + 20) = 1280 → "1.28 m"
    expect(screen.getByText(/pedir 1\.28 m · 4 pzs/)).toBeInTheDocument()
    // Placas: 2 × (200×300) = 120,000 mm² → "1200 cm²"; la pieza más ancha manda.
    expect(screen.getByText(/Placa 5 mm/)).toBeInTheDocument()
    expect(screen.getByText(/2 pzs · área 1200 cm²/)).toBeInTheDocument()
    expect(screen.getByText(/ancho mínimo 200 mm/)).toBeInTheDocument()
  })

  test('capturar la barra (chip sugerida) calcula y dibuja el acomodo de tubos', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    await user.click(screen.getByRole('button', { name: '6 m' }))

    expect(screen.getByText('Barra 1')).toBeInTheDocument()
    // 4×300 + 4 cortes de 20 = 1280 usados → sobran 4720.
    expect(screen.getByText(/Sobrante: 4\.72 m/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Barra de 6 m con 4 piezas/ })).toBeInTheDocument()
  })

  test('capturar el ancho de tira acomoda las placas por filas', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    // 2 piezas de 200 de ancho en tira de 450: 200+20+200 = 420 ≤ 450 → una
    // fila de 300 mm de largo; aprovechamiento 120000/(300×450) ≈ 89 %.
    await user.type(screen.getByLabelText(/Ancho de la tira del proveedor/), '450')
    expect(screen.getByText(/Pide 300 mm de tira de 450 mm/)).toBeInTheDocument()
    expect(screen.getByText(/aprovechamiento 89%/)).toBeInTheDocument()
  })

  test('tira más angosta que la pieza → aviso con el ancho mínimo, sin diagrama', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    await user.type(screen.getByLabelText(/Ancho de la tira del proveedor/), '150')
    expect(screen.getByText(/se necesita al menos 200 mm de ancho/)).toBeInTheDocument()
    expect(screen.queryByText(/Pide .* de tira/)).not.toBeInTheDocument()
  })

  test('guardar: payload con tubos y placas normalizados + presentación capturada', async () => {
    saveMut.mockResolvedValue({ pieces: [] })
    presMut.mockResolvedValue({})
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    await user.click(screen.getByRole('button', { name: '6 m' }))
    await user.click(screen.getByRole('button', { name: /guardar lista de corte/i }))

    expect(saveMut).toHaveBeenCalledWith([
      {
        material_type: 'tube', diameter_mm: 30, length_mm: 300, quantity: 4,
        requested_label: 'Botador 30', source_item_id: null,
      },
      {
        material_type: 'plate', thickness_mm: 5, width_mm: 200, length_mm: 300,
        quantity: 2, requested_label: 'Placa X', source_item_id: null,
      },
    ])
    // La barra capturada queda registrada como presentación del proveedor
    // (solo tubos: las tiras de placa se venden por largo, sin presentación fija).
    expect(presMut).toHaveBeenCalledWith({ material_type: 'tube', diameter_mm: 30, length_mm: 6000 })
  })

  test('agregar candidato DYMMSA pre-llena con las medidas nominales', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    expect(screen.getByText('Botador 25')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /agregar$/i }))

    // Aparece el grupo del diámetro pre-llenado: 2 × (250+20) = 540 mm.
    expect(screen.getByText(/Ø25 mm/)).toBeInTheDocument()
    expect(screen.getByText(/pedir 540 mm · 2 pzs/)).toBeInTheDocument()
    // Y el candidato desaparece de la lista (ya está en la lista de corte).
    expect(screen.queryByRole('button', { name: /agregar$/i })).not.toBeInTheDocument()
  })
})

describe('CutBarDiagram', () => {
  test('cuando el acomodo manual excede la barra lo dice en rojo, no truena', () => {
    renderWithProviders(
      <CutBarDiagram
        barLengthMm={1800}
        marginMm={20}
        segments={[
          { unitKey: 'u0', lengthMm: 1000 },
          { unitKey: 'u1', lengthMm: 1000 },
        ]}
      />,
    )
    // 2000 + 2 cortes de 20 = 2040 → excede por 240.
    expect(screen.getByText(/Excede la barra por 240 mm/)).toBeInTheDocument()
  })
})
