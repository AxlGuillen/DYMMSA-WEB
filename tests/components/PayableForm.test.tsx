/**
 * PayableForm (issue #84): la regla que da valor al plazo del proveedor — el
 * vencimiento se pre-llena (invoice_date + payment_terms_days) y deja de
 * pre-llenarse en cuanto el usuario lo toca a mano.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { PayableForm } from '@/components/finance/PayableForm'

const { createAsync, updateAsync } = vi.hoisted(() => ({
  createAsync: vi.fn().mockResolvedValue({}),
  updateAsync: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/hooks/usePayables', () => ({
  useCreatePayable: () => ({ mutateAsync: createAsync, isPending: false }),
  useUpdatePayable: () => ({ mutateAsync: updateAsync, isPending: false }),
}))

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
  beforeEach(() => vi.clearAllMocks())

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

    // Editar la fecha de factura re-calcula (el usuario no ha tocado el vencimiento).
    await setInvoiceDate('2026-09-10')
    expect(screen.getByLabelText('Vencimiento')).toHaveValue('2026-10-10')

    // Override manual → los cambios posteriores YA NO lo pisan.
    const due = screen.getByLabelText('Vencimiento')
    await user.clear(due)
    await user.type(due, '2026-11-15')
    await setInvoiceDate('2026-09-20')
    expect(screen.getByLabelText('Vencimiento')).toHaveValue('2026-11-15')
  })
})
