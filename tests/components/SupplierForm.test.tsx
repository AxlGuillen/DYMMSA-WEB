/**
 * SupplierForm (#92): a supplier saved with payment terms outside the preset list must
 * open on "Otro…" carrying its value, never blank.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { SupplierForm } from '@/components/suppliers/SupplierForm'
import type { SupplierWithBrands } from '@/types/database'

const { createAsync, updateAsync } = vi.hoisted(() => ({
  createAsync: vi.fn().mockResolvedValue({}),
  updateAsync: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/hooks/useSuppliers', () => ({
  useCreateSupplier: () => ({ mutateAsync: createAsync, isPending: false }),
  useUpdateSupplier: () => ({ mutateAsync: updateAsync, isPending: false }),
  useBrands: () => ({ data: [] }),
  useCreateBrand: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function supplier(overrides: Partial<SupplierWithBrands> = {}): SupplierWithBrands {
  return {
    id: 's1',
    name: 'Perfiles y Herramientas',
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    notes: null,
    payment_terms_days: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    brands: [],
    ...overrides,
  }
}

const terms = () => screen.getByRole('combobox', { name: 'Plazo de pago' })

describe('SupplierForm — plazo de pago', () => {
  beforeEach(() => vi.clearAllMocks())

  test('un plazo guardado fuera de la lista abre en "Otro…" con su valor', () => {
    renderWithProviders(<SupplierForm open onOpenChange={vi.fn()} supplier={supplier({ payment_terms_days: 45 })} />)
    expect(terms()).toHaveTextContent('Otro…')
    expect(screen.getByLabelText('Días de crédito')).toHaveValue('45')
  })

  test('un plazo que sí es preset abre en su etiqueta, sin input libre', () => {
    renderWithProviders(<SupplierForm open onOpenChange={vi.fn()} supplier={supplier({ payment_terms_days: 30 })} />)
    expect(terms()).toHaveTextContent('1 mes')
    expect(screen.queryByLabelText('Días de crédito')).toBeNull()
  })

  test('elegir un preset guarda sus días', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SupplierForm open onOpenChange={vi.fn()} />)
    await user.type(screen.getByLabelText(/Nombre/), 'Klingspor')
    await user.click(terms())
    await user.click(await screen.findByRole('option', { name: '2 meses' }))
    await user.click(screen.getByRole('button', { name: 'Registrar' }))
    expect(createAsync).toHaveBeenCalledWith(expect.objectContaining({ payment_terms_days: 60 }))
  })

  test('Contado es el default y guarda null', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SupplierForm open onOpenChange={vi.fn()} />)
    expect(terms()).toHaveTextContent('Contado')
    await user.type(screen.getByLabelText(/Nombre/), 'Uline')
    await user.click(screen.getByRole('button', { name: 'Registrar' }))
    expect(createAsync).toHaveBeenCalledWith(expect.objectContaining({ payment_terms_days: null }))
  })

  test('"Otro…" sin días no guarda: pide el número o Contado', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SupplierForm open onOpenChange={vi.fn()} />)
    await user.type(screen.getByLabelText(/Nombre/), 'Fastenal')
    await user.click(terms())
    await user.click(await screen.findByRole('option', { name: 'Otro…' }))
    await user.click(screen.getByRole('button', { name: 'Registrar' }))
    expect(await screen.findByText('Captura los días o elige Contado')).toBeInTheDocument()
    expect(createAsync).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Días de crédito'), '45')
    await user.click(screen.getByRole('button', { name: 'Registrar' }))
    expect(createAsync).toHaveBeenCalledWith(expect.objectContaining({ payment_terms_days: 45 }))
  })
})
