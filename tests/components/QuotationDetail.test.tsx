import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import { quotationWithItems, quotationItem } from './helpers/fixtures'
import { QuotationDetail } from '@/components/quotations/QuotationDetail'
import { useCutDraftStore } from '@/stores/cutDraftStore'
import { QUOTATION_DETAIL_TOUR } from '@/lib/tours/quotation-detail'

// Spies de los mutation hooks (hoisted para usarlos dentro de vi.mock).
const { updateAsync, sendAsync, createAsync, deleteAsync, changeStatusAsync, pushMock, fetchJsonMock } = vi.hoisted(() => ({
  updateAsync: vi.fn().mockResolvedValue(undefined),
  sendAsync: vi.fn().mockResolvedValue(undefined),
  createAsync: vi.fn().mockResolvedValue({ id: 'o1' }),
  deleteAsync: vi.fn().mockResolvedValue(undefined),
  changeStatusAsync: vi.fn().mockResolvedValue(undefined),
  pushMock: vi.fn(),
  fetchJsonMock: vi.fn(),
}))

vi.mock('@/lib/fetch-json', () => ({
  fetchJson: fetchJsonMock,
  ApiError: class ApiError extends Error {},
}))

// TourButton importa driver.js (y su CSS) — mock como en el resto de suites de tours.
vi.mock('driver.js', () => ({ driver: vi.fn(() => ({ drive: vi.fn() })) }))
vi.mock('driver.js/dist/driver.css', () => ({}))

vi.mock('@/hooks/useQuotations', () => ({
  useSendForApproval: () => ({ mutateAsync: sendAsync, isPending: false }),
  useUpdateQuotation: () => ({ mutateAsync: updateAsync, isPending: false }),
  useCreateOrderFromQuotation: () => ({ mutateAsync: createAsync, isPending: false }),
  useDeleteQuotation: () => ({ mutateAsync: deleteAsync, isPending: false }),
  useChangeQuotationStatus: () => ({ mutateAsync: changeStatusAsync, isPending: false }),
  ApiError: class ApiError extends Error {},
}))

vi.mock('@/hooks/useOrders', () => ({
  useOrderByQuotationId: () => ({ data: null }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: pushMock }),
}))

/** Valor mostrado en la card-filtro de contador (Aprobados/Rechazados/Pendientes). */
function counter(label: string): string {
  const btn = screen.getByRole('button', { name: new RegExp(label) })
  const ps = btn.querySelectorAll('p')
  return ps[ps.length - 1].textContent ?? ''
}

/** Cotización aprobada con 2 productos pendientes + 1 separador. */
function approvedQuotation() {
  return quotationWithItems({
    status: 'approved',
    quotation_items: [
      quotationItem({ id: 'p1', etm: 'E1', is_approved: null, sort_order: 0 }),
      quotationItem({ id: 'sep', item_type: 'separator', section_label: 'Sección', sort_order: 1 }),
      quotationItem({ id: 'p2', etm: 'E2', is_approved: null, sort_order: 2 }),
    ],
  })
}

describe('QuotationDetail — aprobación de items', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  test('arranca con 2 pendientes y sin aprobados/rechazados', () => {
    renderWithProviders(<QuotationDetail quotation={approvedQuotation()} />)
    expect(counter('Aprobados')).toBe('0')
    expect(counter('Rechazados')).toBe('0')
    expect(counter('Pendientes')).toBe('2')
  })

  test('los separadores no exponen botones de aprobación', () => {
    renderWithProviders(<QuotationDetail quotation={approvedQuotation()} />)
    // Solo los 2 productos tienen toggle ✓/✗, no el separador.
    expect(screen.getAllByRole('button', { name: 'Aprobar' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Rechazar' })).toHaveLength(2)
  })

  test('aprobar un item incrementa el contador de aprobados', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuotationDetail quotation={approvedQuotation()} />)

    await user.click(screen.getAllByRole('button', { name: 'Aprobar' })[0])

    expect(counter('Aprobados')).toBe('1')
    expect(counter('Pendientes')).toBe('1')
    // El item aprobado ahora ofrece "Quitar aprobación".
    expect(screen.getByRole('button', { name: 'Quitar aprobación' })).toBeInTheDocument()
  })

  test('rechazar y luego re-click vuelve a pendiente', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuotationDetail quotation={approvedQuotation()} />)

    await user.click(screen.getAllByRole('button', { name: 'Rechazar' })[0])
    expect(counter('Rechazados')).toBe('1')
    expect(counter('Pendientes')).toBe('1')

    // Re-click en el rechazo activo lo resetea a pendiente.
    await user.click(screen.getByRole('button', { name: 'Quitar rechazo' }))
    expect(counter('Rechazados')).toBe('0')
    expect(counter('Pendientes')).toBe('2')
  })

  test('guardar tras cambiar aprobación llama updateQuotation.mutateAsync', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuotationDetail quotation={approvedQuotation()} />)

    // Cambiar aprobación marca el draft como dirty → aparece "Guardar cambios".
    await user.click(screen.getAllByRole('button', { name: 'Aprobar' })[0])
    await user.click(screen.getByRole('button', { name: /Guardar cambios/ }))

    await waitFor(() => expect(updateAsync).toHaveBeenCalledOnce())
    const payload = updateAsync.mock.calls[0][0] as { id: string; items: unknown[] }
    expect(payload.id).toBe('q1')
    expect(Array.isArray(payload.items)).toBe(true)
  })
})

describe('QuotationDetail — columnas redimensionables (issue #55)', () => {
  beforeEach(() => resetStores())

  test('las columnas ordenables también traen manija (el arrastre no dispara el orden)', () => {
    renderWithProviders(<QuotationDetail quotation={approvedQuotation()} />)
    expect(screen.getByLabelText('Ajustar ancho de Descripción')).toBeInTheDocument()
    expect(screen.getByLabelText('Ajustar ancho de Precio unit.')).toBeInTheDocument()
    expect(screen.getByLabelText('Ajustar ancho de Entrega')).toBeInTheDocument()
  })

  test('Acciones queda fija a la derecha cuando la cotización es editable', () => {
    renderWithProviders(<QuotationDetail quotation={approvedQuotation()} />)
    const header = screen.getByRole('columnheader', { name: /Acciones/ })
    expect(header.className).toContain('sticky')
  })
})

describe('QuotationDetail — planificar corte (issue #71)', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  test('sin ítems DYMMSA no aparece el botón', () => {
    renderWithProviders(<QuotationDetail quotation={approvedQuotation()} />)
    expect(screen.queryByRole('button', { name: /planificar corte/i })).not.toBeInTheDocument()
  })

  test('is_sold=false no cuenta como pieza DYMMSA (no se manda a hacer)', () => {
    const q = quotationWithItems({
      quotation_items: [quotationItem({ id: 'p1', brand: 'DYMMSA', is_sold: false })],
    })
    renderWithProviders(<QuotationDetail quotation={q} />)
    expect(screen.queryByRole('button', { name: /planificar corte/i })).not.toBeInTheDocument()
  })

  test('con pieza DYMMSA siembra el borrador del corte rápido y navega', async () => {
    const user = userEvent.setup()
    const candidates = [
      {
        itemId: 'p1', etm: 'DY-1', description: 'Botador', quantity: 4,
        cutKind: 'tube', diameterMm: 30, thicknessMm: null, widthMm: null, lengthMm: 300,
      },
    ]
    fetchJsonMock.mockResolvedValue({ candidates })
    // ' dymmsa ' con basura: misma normalización trim+upper que el resto del flujo.
    const q = quotationWithItems({
      quotation_items: [quotationItem({ id: 'p1', brand: ' dymmsa ' })],
    })
    renderWithProviders(<QuotationDetail quotation={q} />)

    await user.click(screen.getByRole('button', { name: /planificar corte/i }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard/cutting'))
    expect(fetchJsonMock).toHaveBeenCalledWith(`/api/quotations/${q.id}/cut-candidates`)
    const store = useCutDraftStore.getState()
    expect(store.candidates).toEqual(candidates)
    expect(store.seededFrom).toBe('Cotización de prueba')
  })
})

describe('QuotationDetail — vista guiada (issue #74)', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  test('anti-drift: en sent_for_approval existen los 5 bloques del tour', () => {
    // El estado más rico para el tour: con link de aprobación Y filter cards.
    const q = quotationWithItems({
      status: 'sent_for_approval',
      approval_token: 'tok-1',
      quotation_items: [quotationItem({ id: 'p1', is_approved: null })],
    })
    renderWithProviders(<QuotationDetail quotation={q} />)

    for (const step of QUOTATION_DETAIL_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('en draft el link de aprobación no existe — el tour lo salta sin tronar', () => {
    const q = quotationWithItems({ status: 'draft', quotation_items: [quotationItem({ id: 'p1' })] })
    renderWithProviders(<QuotationDetail quotation={q} />)
    expect(document.querySelector('[data-tour="qd-approval-link"]')).toBeNull()
    // El resto sí está.
    expect(document.querySelector('[data-tour="qd-status"]')).not.toBeNull()
    expect(document.querySelector('[data-tour="qd-items"]')).not.toBeNull()
  })
})
