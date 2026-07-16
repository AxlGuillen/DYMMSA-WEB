import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuotationEditor } from '@/components/quoter/QuotationEditor'
import { useQuotationStore } from '@/stores/quotationStore'
import { useColumnStore } from '@/stores/columnStore'
import { resetStores, seedQuotationItems } from './helpers/stores'
import { quotationItemRow } from './helpers/fixtures'

// TanStack hook mockeado a nivel de módulo (convención del proyecto): sin
// QueryClient en jsdom; el lookup de catálogo se cubre en tests/api.
vi.mock('@/hooks/useUrreaCatalog', () => ({
  useCatalogDescription: () => ({ data: null }),
}))

/** Valor numérico dentro de la card de resumen cuya etiqueta es `label`. */
function cardValue(label: string): string {
  // Las cards viven en el grid de resumen; la leyenda de la tabla repite algunas
  // etiquetas ("Sin datos"/"Sin cantidad"), así que scopeamos al grid.
  const grid = screen.getByText('Total productos').closest('div.grid') as HTMLElement
  const card = within(grid).getByText(label).closest('div')!
  const ps = card.querySelectorAll('p')
  return ps[ps.length - 1].textContent ?? ''
}

describe('QuotationEditor', () => {
  beforeEach(() => {
    resetStores()
    vi.restoreAllMocks()
  })
  afterEach(() => vi.restoreAllMocks())

  test('estado vacío: muestra el mensaje de sin productos', () => {
    render(<QuotationEditor />)
    expect(screen.getByText(/No hay productos/)).toBeInTheDocument()
  })

  test('cards de resumen cuentan completos / sin cantidad / sin datos', () => {
    seedQuotationItems([
      quotationItemRow({ etm: 'A', model_code: 'MC1', quantity: 2, unit_price: 100, description: 'x' }), // completo
      quotationItemRow({ etm: 'B', model_code: 'MC2', quantity: null, unit_price: 50, description: 'y' }), // sin cantidad
      quotationItemRow({ etm: 'C', model_code: '', quantity: null, unit_price: null, description: '' }),   // sin datos
    ])
    render(<QuotationEditor />)

    expect(cardValue('Total productos')).toBe('3')
    expect(cardValue('Completos')).toBe('1')
    expect(cardValue('Sin cantidad')).toBe('1')
    expect(cardValue('Sin datos')).toBe('1')
  })

  test('total parcial usa useCurrency (modo normal)', () => {
    seedQuotationItems([
      quotationItemRow({ etm: 'A', model_code: 'MC1', quantity: 2, unit_price: 100, description: 'x' }), // 200
      quotationItemRow({ etm: 'D', model_code: 'MC3', quantity: 1, unit_price: 30, description: 'z' }),  // 30
    ])
    render(<QuotationEditor />)
    // total 230 es único (los subtotales por fila son 200 y 30).
    expect(screen.getByText('$230.00')).toBeInTheDocument()
  })

  test('eliminar una fila quita el producto del store', async () => {
    const user = userEvent.setup()
    seedQuotationItems([
      quotationItemRow({ etm: 'KEEP', model_code: 'MC1', quantity: 1, unit_price: 10, description: 'x' }),
      quotationItemRow({ etm: 'GONE', model_code: 'MC2', quantity: 1, unit_price: 20, description: 'y' }),
    ])
    render(<QuotationEditor />)

    const removeButtons = screen.getAllByRole('button', { name: 'Eliminar' })
    await user.click(removeButtons[1]) // elimina 'GONE'

    expect(useQuotationStore.getState().items).toHaveLength(1)
    expect(screen.queryByText('GONE')).not.toBeInTheDocument()
    expect(screen.getByText('KEEP')).toBeInTheDocument()
  })

  test('insertar separador agrega una fila separadora', async () => {
    const user = userEvent.setup()
    seedQuotationItems([
      quotationItemRow({ etm: 'A', model_code: 'MC1', quantity: 1, unit_price: 10, description: 'x' }),
    ])
    render(<QuotationEditor />)

    await user.click(screen.getByRole('button', { name: 'Insertar separador' }))

    const items = useQuotationStore.getState().items
    expect(items.some((i) => i.item_type === 'separator')).toBe(true)
    expect(screen.getByPlaceholderText(/Nombre de la sección/)).toBeInTheDocument()
  })

  test('"Agregar producto" abre el modal y guardar agrega al store', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ found: [] }),
    } as Response)
    render(<QuotationEditor />)

    await user.click(screen.getByRole('button', { name: /Agregar producto/ }))
    // Modal abierto (el título es un heading; evita colisión con el botón).
    expect(await screen.findByRole('heading', { name: 'Agregar producto' })).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Ej: H7-ET400'), 'NUEVO')
    await user.type(screen.getByPlaceholderText('Ej: 95040'), 'MC9')
    await user.type(screen.getByPlaceholderText('0.00'), '99')
    await user.type(screen.getByPlaceholderText('0'), '5')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() =>
      expect(useQuotationStore.getState().items.some((i) => i.etm === 'NUEVO')).toBe(true),
    )
  })

  test('columna Desc. DYMMSA: catálogo gana (badge URREA); sin match usa la curada', () => {
    seedQuotationItems([
      quotationItemRow({ _id: 'a', etm: 'E1', model_code: 'MC1', brand: 'URREA', dymmsa_description: 'curada que pierde' }),
      quotationItemRow({ _id: 'b', etm: 'E2', model_code: 'MC2', brand: 'URREA', dymmsa_description: 'Martillo curado' }),
    ])
    // Mapa indexado por catalogKey (MARCA|CODIGO)
    useQuotationStore.setState({ catalogDescriptions: { 'URREA|MC1': 'Oficial URREA 14"' } })

    render(<QuotationEditor />)

    expect(screen.getByText('Oficial URREA 14"')).toBeInTheDocument()
    expect(screen.getByText('URREA', { selector: 'span[data-slot="badge"], .shrink-0' })).toBeInTheDocument()
    expect(screen.getByText('Martillo curado')).toBeInTheDocument()
    expect(screen.queryByText('curada que pierde')).not.toBeInTheDocument()
  })

  test('REGLA: el catálogo de OTRA marca no aplica → usa la curada', () => {
    // MC1 solo está en el catálogo bajo URREA; el ítem es SURTEK → no hereda.
    seedQuotationItems([
      quotationItemRow({ _id: 'a', etm: 'E1', model_code: 'MC1', brand: 'SURTEK', dymmsa_description: 'curada Surtek' }),
    ])
    useQuotationStore.setState({ catalogDescriptions: { 'URREA|MC1': 'Oficial URREA 14"' } })

    render(<QuotationEditor />)

    expect(screen.getByText('curada Surtek')).toBeInTheDocument()
    expect(screen.queryByText('Oficial URREA 14"')).not.toBeInTheDocument()
  })

  // ─── Columnas visibles (issue #18) ─────────────────────────────────────

  test('ocultar una columna quita header y celdas, y el separador ajusta su colSpan', async () => {
    useColumnStore.setState({ hidden: { 'quoter-editor': ['brand'] } })
    seedQuotationItems([
      quotationItemRow({ _id: 'a', etm: 'E1', model_code: 'MC1', brand: 'URREA', quantity: 1, unit_price: 10, description: 'x' }),
      quotationItemRow({ _id: 'sep', item_type: 'separator', section_label: 'Sección' }),
    ])
    render(<QuotationEditor />)

    // Tras el frame de useMounted la columna Marca desaparece
    await waitFor(() =>
      expect(screen.queryByRole('columnheader', { name: 'Marca' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('columnheader', { name: 'ETM' })).toBeInTheDocument()
    expect(screen.queryByText('URREA', { selector: 'td' })).not.toBeInTheDocument()

    // 13 columnas − 1 oculta = 12 visibles; el label del separador abarca 12 − 2
    const sepInput = screen.getByPlaceholderText(/nombre de la sección/i)
    const sepCell = sepInput.closest('td')!
    expect(sepCell.colSpan).toBe(10)
  })

  test('el picker no ofrece las columnas fijas y sí las ocultables', async () => {
    const user = userEvent.setup()
    seedQuotationItems([
      quotationItemRow({ etm: 'E1', model_code: 'MC1', quantity: 1, unit_price: 10, description: 'x' }),
    ])
    render(<QuotationEditor />)

    await user.click(screen.getByRole('button', { name: /columnas/i }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Marca' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'ETM' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Acciones' })).not.toBeInTheDocument()
  })
})
