import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductModal } from '@/components/quoter/ProductModal'
import { useCatalogDescription } from '@/hooks/useUrreaCatalog'
import type { QuotationItemRow } from '@/types/database'

// TanStack hook mocked per module: no QueryClient in jsdom; the catalog lookup
// lives in tests/api. Default is no match (data: null).
vi.mock('@/hooks/useUrreaCatalog', () => ({
  useCatalogDescription: vi.fn(() => ({ data: null })),
}))
const mockCatalogDesc = vi.mocked(useCatalogDescription)

/** Mocks fetch /api/quotes/lookup returning `found` (etm_products rows). */
function mockLookup(found: unknown[]) {
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
    mockLookup([]) // ETM not in the catalog
    const onSave = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <ProductModal mode="create" open onOpenChange={onOpenChange} onSave={onSave} />,
    )

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const [payload, id] = onSave.mock.calls[0]
    expect(id).toBeUndefined() // create → no id
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

  test('ETM duplicado en la cotización → aviso informativo y SÍ guarda (issue #40)', async () => {
    const user = userEvent.setup()
    mockLookup([]) // duplicated inside the quotation, but not in the catalog
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
    // Live notice, not an error: repeating ETMs is valid — different projects in
    // the same quotation can ask for the same product.
    expect(
      await screen.findByText('Este ETM ya está en la cotización — se agregará repetido.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][0]).toMatchObject({ etm: 'DUP-1', quantity: 3 })
  })

  test('ETM existente en el catálogo → precarga datos y SÍ guarda (issue #40)', async () => {
    const user = userEvent.setup()
    mockLookup([{
      etm: 'CAT-1',
      description: 'Bearing puller',
      description_es: 'Extractor de baleros',
      model_code: 'MC77',
      brand: 'URREA',
      price: 250,
      is_sold: true,
      dymmsa_description: 'Extractor 3 patas',
    }])
    const onSave = vi.fn()

    render(<ProductModal mode="create" open onOpenChange={vi.fn()} onSave={onSave} />)

    await user.type(screen.getByPlaceholderText('Ej: H7-ET400'), 'CAT-1')
    await user.tab() // blur → lookup → prefill

    // Informational notice (not an error) + fields prefilled from the catalog
    expect(await screen.findByText(/datos precargados/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Extractor de baleros')).toBeInTheDocument()
    expect(screen.getByDisplayValue('MC77')).toBeInTheDocument()
    expect(screen.getByDisplayValue('250')).toBeInTheDocument()

    // Quantity does not come from the catalog: the user types it
    await user.type(screen.getByPlaceholderText('0'), '3')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const [payload] = onSave.mock.calls[0]
    expect(payload).toMatchObject({
      etm: 'CAT-1',
      description_es: 'Extractor de baleros',
      model_code: 'MC77',
      brand: 'URREA',
      unit_price: 250,
      quantity: 3,
      _inDb: true, // already in the catalog → the row shows "En catálogo"
    })
  })

  test('con match de catálogo → onCatalogResolved(code normalizado, descripción) al guardar', async () => {
    const user = userEvent.setup()
    mockLookup([]) // ETM not duplicated
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

    // Lowercase/spaced model_code: the callback must receive it normalized.
    await user.type(screen.getByPlaceholderText('Ej: H7-ET400'), 'NEW-2')
    await user.type(screen.getByPlaceholderText('Ej: 95040'), '  mc9  ')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onCatalogResolved).toHaveBeenCalledWith('MC9', 'Pinza oficial URREA')
  })

  test('fallo de red en el lookup → no bloquea: se agrega como nuevo', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const onSave = vi.fn()

    render(<ProductModal mode="create" open onOpenChange={vi.fn()} onSave={onSave} />)

    await fillRequired(user, 'NET-1')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const [payload] = onSave.mock.calls[0]
    expect(payload).toMatchObject({ etm: 'NET-1', _inDb: false }) // no prefill, no error
    expect(screen.queryByText(/datos precargados/)).not.toBeInTheDocument()
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

    // react-hook-form won't validate the required field until it sees a change event,
    // so we retype the SAME ETM (clear+type) — still "unchanged" for the item.
    const etm = await screen.findByDisplayValue('KEEP-1')
    await user.clear(etm)
    await user.type(etm, 'KEEP-1')
    // Submit via the form: clicking the button right after editing the ETM fires its
    // onBlur (isCheckingEtm → disabled) and the click gets swallowed.
    fireEvent.submit(etm.closest('form')!)

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][1]).toBe('row-1') // edit → passes the id
    expect(fetchSpy).not.toHaveBeenCalled()        // unchanged ETM → skip DB
  })
})
