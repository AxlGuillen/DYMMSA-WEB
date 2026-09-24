/** PayableForm (#84): the due date is prefilled from the supplier terms until the user edits it. */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { PayableForm } from '@/components/finance/PayableForm'

const { createAsync, updateAsync, state } = vi.hoisted(() => ({
  createAsync: vi.fn().mockResolvedValue({}),
  updateAsync: vi.fn().mockResolvedValue({}),
  state: { isAdmin: false, events: [] as unknown[] },
}))

vi.mock('@/hooks/usePayables', () => ({
  useCreatePayable: () => ({ mutateAsync: createAsync, isPending: false }),
  useUpdatePayable: () => ({ mutateAsync: updateAsync, isPending: false }),
  usePayableEvents: (_id: string, enabled: boolean) => ({ data: enabled ? state.events : undefined, isLoading: false, isError: false }),
}))

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ isAdmin: state.isAdmin, profile: null }),
}))

const PAID_ROW = {
  id: 'p1', supplier_id: 's30', concept: 'Material', amount: 1500, invoice_date: '2026-09-01', due_date: '2026-10-01',
  status: 'pending' as const, paid_at: null, notes: null, created_at: '', updated_at: '',
  supplier: { id: 's30', name: 'Con Crédito SA', payment_terms_days: 30 },
}

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({
    data: {
      data: [
        { id: 's30', name: 'Con Crédito SA', payment_terms_days: 30 },
        { id: 's0', name: 'De Contado', payment_terms_days: null },
      ],
      count: 2, page: 1, pageSize: 100, totalPages: 1,
    },
  }),
}))

async function setInvoiceDate(value: string) {
  const input = screen.getByLabelText('Fecha de factura')
  const user = userEvent.setup()
  await user.clear(input)
  await user.type(input, value)
  return user
}

describe('PayableForm — pre-llenado del vencimiento', () => {
  beforeEach(() => { vi.clearAllMocks(); state.isAdmin = false; state.events = [] })

  test('elegir proveedor con plazo pre-llena vencimiento = factura + días', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PayableForm open onOpenChange={vi.fn()} />)

    await setInvoiceDate('2026-09-01')
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: /Con Crédito SA/ }))

    expect(screen.getByLabelText('Vencimiento')).toHaveValue('2026-10-01')
  })

  test('proveedor de contado pre-llena con la misma fecha de factura', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PayableForm open onOpenChange={vi.fn()} />)

    await setInvoiceDate('2026-09-05')
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: /De Contado/ }))

    expect(screen.getByLabelText('Vencimiento')).toHaveValue('2026-09-05')
  })

  test('cambiar la fecha de factura re-pre-llena... hasta que el usuario toca el vencimiento', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PayableForm open onOpenChange={vi.fn()} />)

    await setInvoiceDate('2026-09-01')
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: /Con Crédito SA/ }))
    expect(screen.getByLabelText('Vencimiento')).toHaveValue('2026-10-01')

    // Editing the invoice date recalculates while the due date is untouched.
    await setInvoiceDate('2026-09-10')
    expect(screen.getByLabelText('Vencimiento')).toHaveValue('2026-10-10')

    // Manual override → later changes no longer overwrite it.
    const due = screen.getByLabelText('Vencimiento')
    await user.clear(due)
    await user.type(due, '2026-11-15')
    await setInvoiceDate('2026-09-20')
    expect(screen.getByLabelText('Vencimiento')).toHaveValue('2026-11-15')
  })
})

describe('PayableForm — estado y fecha de pago al editar (#100)', () => {
  beforeEach(() => { vi.clearAllMocks(); state.isAdmin = false; state.events = [] })

  test('al registrar no hay estado ni fecha de pago: nace pendiente', () => {
    renderWithProviders(<PayableForm open onOpenChange={vi.fn()} />)
    expect(screen.queryByLabelText('Estado')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Pagada el')).not.toBeInTheDocument()
  })

  test('pasar a Pagada habilita la fecha, la pre-llena con hoy y viaja en el PATCH con el estado', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PayableForm open onOpenChange={vi.fn()} payable={PAID_ROW} />)
    const date = screen.getByLabelText('Pagada el') as HTMLInputElement
    expect(date).toBeDisabled()

    await user.click(screen.getByLabelText('Estado'))
    await user.click(await screen.findByRole('option', { name: 'Pagada' }))
    expect(date).toBeEnabled()
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    await user.clear(date)
    await user.type(date, '2026-09-10')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 'p1',
      updates: expect.objectContaining({ status: 'paid', paid_at: '2026-09-10' }),
    })
  })

  test('sin tocar el estado, el PATCH no lo manda (evitaría re-sellar la fecha real)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PayableForm open onOpenChange={vi.fn()} payable={{ ...PAID_ROW, status: 'paid', paid_at: '2026-09-10' }} />)
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    const updates = updateAsync.mock.calls[0][0].updates
    expect('status' in updates).toBe(false)
    expect('paid_at' in updates).toBe(false)
  })

  test('corregir solo la fecha de una pagada manda paid_at sin status', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PayableForm open onOpenChange={vi.fn()} payable={{ ...PAID_ROW, status: 'paid', paid_at: '2026-09-10' }} />)
    const date = screen.getByLabelText('Pagada el')
    await user.clear(date)
    await user.type(date, '2026-09-12')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    const updates = updateAsync.mock.calls[0][0].updates
    expect(updates.paid_at).toBe('2026-09-12')
    expect('status' in updates).toBe(false)
  })

  test('un resbalón pagada → pendiente → pagada conserva la fecha real, no la pisa con hoy', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PayableForm open onOpenChange={vi.fn()} payable={{ ...PAID_ROW, status: 'paid', paid_at: '2026-09-03' }} />)
    await user.click(screen.getByLabelText('Estado'))
    await user.click(await screen.findByRole('option', { name: 'Pendiente' }))
    expect((screen.getByLabelText('Pagada el') as HTMLInputElement).value).toBe('')
    await user.click(screen.getByLabelText('Estado'))
    await user.click(await screen.findByRole('option', { name: 'Pagada' }))
    expect((screen.getByLabelText('Pagada el') as HTMLInputElement).value).toBe('2026-09-03')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    const updates = updateAsync.mock.calls[0][0].updates
    expect('status' in updates).toBe(false)
    expect('paid_at' in updates).toBe(false)
  })

  test('el historial solo existe para el admin (ADR-028)', () => {
    state.events = [{ id: 1, action: 'status_changed', actor_name: 'Diego', data: { to: { status: 'paid', paid_at: '2026-09-10' } }, created_at: new Date().toISOString() }]
    const { unmount } = renderWithProviders(<PayableForm open onOpenChange={vi.fn()} payable={PAID_ROW} />)
    expect(screen.queryByTestId('payable-history')).not.toBeInTheDocument()
    unmount()

    state.isAdmin = true
    renderWithProviders(<PayableForm open onOpenChange={vi.fn()} payable={PAID_ROW} />)
    const history = screen.getByTestId('payable-history')
    expect(history).toHaveTextContent('Marcada como pagada el')
    expect(history).toHaveTextContent('Diego')
  })
})
