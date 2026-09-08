/** CutPlanner (#59): net need, layout on capturing a presentation, save payload and SVG states. */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { CutPlanner } from '@/components/orders/CutPlanner'
import { CutBarDiagram } from '@/components/orders/CutBarDiagram'
import { CUT_PLANNER_TOUR } from '@/lib/tours/cut-planner'
import type { CutPlanResponse } from '@/hooks/useCutPlan'

const saveMut = vi.hoisted(() => vi.fn())
const presMut = vi.hoisted(() => vi.fn())
const settingsMut = vi.hoisted(() => vi.fn())
const driveMock = vi.hoisted(() => vi.fn())
const driverMock = vi.hoisted(() => vi.fn(() => ({ drive: driveMock })))

vi.mock('driver.js', () => ({ driver: driverMock }))
vi.mock('driver.js/dist/driver.css', () => ({}))

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
    // Tubes: 4 × (300 + 20) = 1280 → "1.28 m"
    expect(screen.getByText(/pedir 1\.28 m · 4 pzs/)).toBeInTheDocument()
    // Plates: 2 × (200×300) = 120,000 mm² → "1200 cm²"; the widest piece wins.
    expect(screen.getByText(/Placa 5 mm/)).toBeInTheDocument()
    expect(screen.getByText(/2 pzs · área 1200 cm²/)).toBeInTheDocument()
    expect(screen.getByText(/ancho mínimo 200 mm/)).toBeInTheDocument()
  })

  test('capturar la barra (chip sugerida) calcula y dibuja el acomodo de tubos', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    await user.click(screen.getByRole('button', { name: '6 m' }))

    expect(screen.getByText('Barra 1')).toBeInTheDocument()
    // 4×300 + 4 cuts of 20 = 1280 used → 4720 left.
    expect(screen.getByText(/Sobrante: 4\.72 m/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Barra de 6 m con 4 piezas/ })).toBeInTheDocument()
  })

  test('capturar la hoja del proveedor (ancho × largo) acomoda las placas en hojas', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    // Two 200-wide pieces on a 450 × 400 sheet: 200+20+200 = 420 ≤ 450 → one
    // 300 mm row on ONE sheet, 100 mm of length left.
    await user.type(screen.getByLabelText(/Ancho de la hoja del proveedor/), '450')
    await user.type(screen.getByLabelText(/Largo de la hoja del proveedor/), '400')
    expect(screen.getByText('Hoja 1')).toBeInTheDocument()
    expect(screen.getByText(/1 hoja de 450 mm × 400 mm/)).toBeInTheDocument()
    expect(screen.getByText(/Sobrante: 100 mm de largo/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Hoja de 400 mm × 450 mm con 2 piezas/ })).toBeInTheDocument()
  })

  test('la hoja pagina: si el largo no alcanza para dos filas, abre Hoja 2', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    // Narrow sheet (220): the two 200-wide pieces can't share a row → 2 rows of
    // 300, and 350 of length can't take 300+20+300 → one sheet per row.
    await user.type(screen.getByLabelText(/Ancho de la hoja del proveedor/), '220')
    await user.type(screen.getByLabelText(/Largo de la hoja del proveedor/), '350')
    expect(screen.getByText('Hoja 1')).toBeInTheDocument()
    expect(screen.getByText('Hoja 2')).toBeInTheDocument()
  })

  test('rotación (#81): la pieza más ancha que la hoja se gira; el toggle lo apaga', async () => {
    const user = userEvent.setup()
    const d = data()
    // A single 300 × 140 plate does not fit a 150-wide sheet upright, but ROTATED it does.
    d.pieces = [{
      id: 'pr', order_id: 'o1', material_type: 'plate',
      diameter_mm: null, thickness_mm: 5, width_mm: 300, length_mm: 140,
      quantity: 1, requested_label: 'Placa girable', source_item_id: null,
      sort_order: 0, created_at: '', updated_at: '',
    }]
    renderWithProviders(<CutPlanner data={d} />)

    await user.type(screen.getByLabelText(/Ancho de la hoja del proveedor/), '150')
    await user.type(screen.getByLabelText(/Largo de la hoja del proveedor/), '400')

    // With rotation (default) a layout exists.
    expect(screen.getByText('Hoja 1')).toBeInTheDocument()
    expect(screen.queryByText(/no cabe/)).not.toBeInTheDocument()

    // Turning rotation off (grain wins) brings the warning back.
    await user.click(screen.getByLabelText('Permitir rotar piezas de 5 mm'))
    expect(screen.queryByText('Hoja 1')).not.toBeInTheDocument()
    expect(screen.getByText(/no cabe/)).toBeInTheDocument()
  })

  test('hoja más angosta que la pieza → aviso, sin diagrama', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    await user.type(screen.getByLabelText(/Ancho de la hoja del proveedor/), '150')
    await user.type(screen.getByLabelText(/Largo de la hoja del proveedor/), '400')
    expect(screen.getByText(/no cabe/)).toBeInTheDocument()
    expect(screen.queryByText('Hoja 1')).not.toBeInTheDocument()
  })

  test('guardar: payload con tubos y placas normalizados + presentación capturada', async () => {
    saveMut.mockResolvedValue({ pieces: [] })
    presMut.mockResolvedValue({})
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    await user.click(screen.getByRole('button', { name: '6 m' }))
    await user.type(screen.getByLabelText(/Ancho de la hoja del proveedor/), '450')
    await user.type(screen.getByLabelText(/Largo de la hoja del proveedor/), '400')
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
    // Bar AND sheet captured become supplier presentations (#64).
    expect(presMut).toHaveBeenCalledWith({ material_type: 'tube', diameter_mm: 30, length_mm: 6000 })
    expect(presMut).toHaveBeenCalledWith({ material_type: 'plate', thickness_mm: 5, width_mm: 450, length_mm: 400 })
  })

  test('ajuste manual: mover una pieza abre barra nueva; cambiar el margen lo descarta', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    await user.click(screen.getByRole('button', { name: '6 m' }))
    expect(screen.queryByText('Barra 2')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Mover a una barra nueva' })[0])
    expect(screen.getByText('Barra 2')).toBeInTheDocument()

    // Changing the margin invalidates the signature: the manual layout is dropped
    // instead of silently going stale.
    await user.clear(screen.getByLabelText(/Margen por corte/))
    await user.type(screen.getByLabelText(/Margen por corte/), '30')
    expect(screen.queryByText('Barra 2')).not.toBeInTheDocument()
  })

  test('vista guiada: todos los selectores del tour existen en la página (anti-drift)', () => {
    // Fails here if a data-tour is renamed or dropped, before the step vanishes silently.
    renderWithProviders(<CutPlanner data={data()} />)
    for (const step of CUT_PLANNER_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('vista guiada: el botón arranca driver.js solo con los bloques presentes', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    await user.click(screen.getByRole('button', { name: /vista guiada/i }))

    expect(driveMock).toHaveBeenCalledOnce()
    const config = driverMock.mock.calls[0][0]
    // Full fixture → all 8 blocks, each step with its resolved ELEMENT.
    expect(config.steps.map((s: { element: Element }) => s.element)).toEqual(
      CUT_PLANNER_TOUR.map((s) => document.querySelector(s.selector)),
    )
    expect(config.doneBtnText).toBe('Listo')
  })

  test('agregar candidato DYMMSA pre-llena con las medidas nominales', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={data()} />)

    expect(screen.getByText('Botador 25')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /agregar$/i }))

    // Pre-filled diameter group: 2 × (250+20) = 540 mm.
    expect(screen.getByText(/Ø25 mm/)).toBeInTheDocument()
    expect(screen.getByText(/pedir 540 mm · 2 pzs/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /agregar$/i })).not.toBeInTheDocument()
  })
})

describe('CutPlanner — modo rápido (issue #71)', () => {
  beforeEach(() => vi.clearAllMocks())

  const standaloneData = (): CutPlanResponse => ({
    ...data(),
    order: { id: 'standalone', name: 'Corte rápido', customer_name: 'Corte rápido', status: 'ordered' },
    pieces: [],
  })

  const tubeDraft = () => ({
    key: 'd1', type: 'tube' as const, diameter: '30', thickness: '', width: '',
    length: '300', quantity: '4', requestedLabel: 'Botador 30', sourceItemId: null, etm: null,
  })

  const standaloneProps = (overrides: Record<string, unknown> = {}) => ({
    initialDrafts: [tubeDraft()],
    onDraftsChange: vi.fn(),
    onClear: vi.fn(),
    seededFrom: null as string | null,
    ...overrides,
  })

  test('header en modo rápido: efímero explícito, sin nombre de orden', () => {
    renderWithProviders(<CutPlanner data={standaloneData()} standalone={standaloneProps()} />)
    expect(screen.getByText(/Modo rápido/)).toBeInTheDocument()
    expect(screen.getByText(/no se guarda en el sistema/)).toBeInTheDocument()
    // The footer changes contract here: it records measurements, it does not save a list.
    expect(screen.getByRole('button', { name: /registrar medidas del proveedor/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /guardar lista de corte/i })).not.toBeInTheDocument()
  })

  test('registrar medidas: guarda la presentación capturada y JAMÁS toca la orden', async () => {
    presMut.mockResolvedValue({})
    const user = userEvent.setup()
    renderWithProviders(<CutPlanner data={standaloneData()} standalone={standaloneProps()} />)

    await user.click(screen.getByRole('button', { name: '6 m' }))
    await user.click(screen.getByRole('button', { name: /registrar medidas del proveedor/i }))

    expect(presMut).toHaveBeenCalledWith({ material_type: 'tube', diameter_mm: 30, length_mm: 6000 })
    // Ephemeral by design: the cut-list PUT does not exist in this mode.
    expect(saveMut).not.toHaveBeenCalled()
  })

  test('los cambios del borrador se reportan al store (persistencia localStorage)', async () => {
    const onDraftsChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <CutPlanner data={standaloneData()} standalone={standaloneProps({ onDraftsChange })} />,
    )

    await user.click(screen.getByRole('button', { name: /agregar tubo manual/i }))
    const last = onDraftsChange.mock.lastCall?.[0]
    expect(last).toHaveLength(2)
  })

  test('Limpiar (con confirmación) vacía las piezas y notifica al store', async () => {
    const onClear = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <CutPlanner data={standaloneData()} standalone={standaloneProps({ onClear })} />,
    )

    await user.click(screen.getByRole('button', { name: /^limpiar$/i }))
    // With the dialog open there are two "Limpiar": trigger and action; the action is last.
    const limpiarButtons = screen.getAllByRole('button', { name: /^limpiar$/i })
    await user.click(limpiarButtons[limpiarButtons.length - 1])
    expect(onClear).toHaveBeenCalled()
    expect(screen.getByText('Sin piezas de tubo.')).toBeInTheDocument()
  })

  test('candidatos sembrados desde la cotización usan su nombre en la card', () => {
    renderWithProviders(
      <CutPlanner data={standaloneData()} standalone={standaloneProps({ seededFrom: 'COT-001' })} />,
    )
    expect(screen.getByText(/Piezas DYMMSA de COT-001/)).toBeInTheDocument()
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
    // 2000 + 2 cuts of 20 = 2040 → 240 over.
    expect(screen.getByText(/Excede la barra por 240 mm/)).toBeInTheDocument()
  })
})
