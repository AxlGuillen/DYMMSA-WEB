import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import { quotationWithItems, quotationItem } from './helpers/fixtures'
import { QuotationDetail } from '@/components/quotations/QuotationDetail'

// Spies de los mutation hooks (hoisted para usarlos dentro de vi.mock).
const { updateAsync, sendAsync, createAsync, deleteAsync, changeStatusAsync } = vi.hoisted(() => ({
  updateAsync: vi.fn().mockResolvedValue(undefined),
  sendAsync: vi.fn().mockResolvedValue(undefined),
  createAsync: vi.fn().mockResolvedValue({ id: 'o1' }),
  deleteAsync: vi.fn().mockResolvedValue(undefined),
  changeStatusAsync: vi.fn().mockResolvedValue(undefined),
}))

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
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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
