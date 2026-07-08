import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductModal } from '@/components/quoter/ProductModal'
import { useCatalogDescription } from '@/hooks/useUrreaCatalog'
import type { QuotationItemRow } from '@/types/database'

// TanStack hook mockeado a nivel de módulo (convención del proyecto): sin
// QueryClient en jsdom; el lookup de catálogo se cubre en tests/api.
// vi.fn controlable por test: default sin match (data: null).
vi.mock('@/hooks/useUrreaCatalog', () => ({
  useCatalogDescription: vi.fn(() => ({ data: null })),
}))
const mockCatalogDesc = vi.mocked(useCatalogDescription)

/** Mockea fetch /api/quotes/lookup devolviendo `found`. */
function mockLookup(found: string[]) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    json: async () => ({ found }),
  } as Response)
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>, etm = 'NEW-1') {
  await user.type(screen.getByPlaceholderText('Ej: H7-ET400'), etm)
  await user.type(screen.getByPlaceholderText('Ej: 95040'), 'MC9')
  await user.type(screen.getByPlaceholderText('0.00'), '150.50')
  await user.type(screen.getByPlaceholderText('0'), '3')
}

describe('ProductModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockCatalogDesc.mockReturnValue({ data: null } as ReturnType<typeof useCatalogDescription>)
  })
  afterEach(() => vi.restoreAllMocks())

  test('submit válido (create) → onSave con payload transformado + cierra', async () => {
    const user = userEvent.setup()
    mockLookup([]) // ETM no existe en catálogo
    const onSave = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <ProductModal mode="create" open onOpenChange={onOpenChange} onSave={onSave} />,
    )

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const [payload, id] = onSave.mock.calls[0]
    expect(id).toBeUndefined() // create → sin id
    expect(payload).toMatchObject({
      item_type: 'product',
      section_label: '',
      etm: 'NEW-1',
      model_code: 'MC9',
      unit_price: 150.5, // parseNumber
      quantity: 3,       // parseInteger
      delivery_time: 'immediate',
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('ETM duplicado en la cotización (existingEtms) → error y NO guarda', async () => {
    const user = userEvent.setup()
    const fetchSpy = mockLookup([])
    const onSave = vi.fn()

    render(
      <ProductModal
        mode="create"
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
        existingEtms={['DUP-1']}
      />,
    )

    await fillRequired(user, 'DUP-1')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    expect(await screen.findByText('Este ETM ya existe en la cotización')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
    // El duplicado local corta antes de consultar el catálogo.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('ETM duplicado en el catálogo (fetch found) → error y NO guarda', async () => {
    const user = userEvent.setup()
    mockLookup(['CAT-1'])
    const onSave = vi.fn()

    render(<ProductModal mode="create" open onOpenChange={vi.fn()} onSave={onSave} />)

    await fillRequired(user, 'CAT-1')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    expect(await screen.findByText('Este ETM ya existe en el catálogo')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  test('con match de catálogo → onCatalogResolved(code normalizado, descripción) al guardar', async () => {
    const user = userEvent.setup()
    mockLookup([]) // ETM no duplicado
    mockCatalogDesc.mockReturnValue({ data: 'Pinza oficial URREA' } as ReturnType<typeof useCatalogDescription>)
    const onSave = vi.fn()
    const onCatalogResolved = vi.fn()

    render(
      <ProductModal
        mode="create"
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
        onCatalogResolved={onCatalogResolved}
      />,
    )

    // model_code en minúsculas/espacios: el callback debe recibirlo normalizado.
    await user.type(screen.getByPlaceholderText('Ej: H7-ET400'), 'NEW-2')
    await user.type(screen.getByPlaceholderText('Ej: 95040'), '  mc9  ')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onCatalogResolved).toHaveBeenCalledWith('MC9', 'Pinza oficial URREA')
  })

  test('modo edit con ETM sin cambios → no consulta el catálogo y guarda', async () => {
    const user = userEvent.setup()
    const fetchSpy = mockLookup([])
    const onSave = vi.fn()
    const item: QuotationItemRow = {
      _id: 'row-1',
      item_type: 'product',
      section_label: '',
      etm: 'KEEP-1',
      description: 'Existente',
      description_es: 'Existente',
      dymmsa_description: 'Existente',
      model_code: 'MC1',
      brand: 'URREA',
      unit_price: 100,
      quantity: 2,
      delivery_time: 'immediate',
      _inDb: true,
      is_approved: null,
    }

    render(<ProductModal mode="edit" item={item} open onOpenChange={vi.fn()} onSave={onSave} />)

    // reset() popula los campos en un useEffect. react-hook-form no valida el
    // campo required hasta recibir un evento de cambio, así que reescribimos el
    // MISMO ETM (clear+type) — sigue "sin cambios" respecto al item original.
    const etm = await screen.findByDisplayValue('KEEP-1')
    await user.clear(etm)
    await user.type(etm, 'KEEP-1')
    // submit vía form: hacer click en el botón justo tras editar el ETM dispara
    // su onBlur (isCheckingEtm → botón disabled) y se tragaría el click.
    fireEvent.submit(etm.closest('form')!)

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][1]).toBe('row-1') // edit → pasa el id
    expect(fetchSpy).not.toHaveBeenCalled()        // ETM sin cambios → skip DB
  })
})
