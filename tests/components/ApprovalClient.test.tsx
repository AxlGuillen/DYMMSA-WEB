/** Public approval page (#24): brand/project filters and contextual "approve visible". No API calls. */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { quotationWithItems, quotationItem, separatorRow } from './helpers/fixtures'
import { ApprovalClient } from '@/app/approve/[token]/ApprovalClient'
import { APPROVAL_TOUR } from '@/lib/tours/approval'
import { SEPARATOR_PALETTE, SEPARATOR_COLOR_KEYS } from '@/lib/separator-palette'
import type { QuotationItem } from '@/types/database'

const driveMock = vi.hoisted(() => vi.fn())
const driverMock = vi.hoisted(() => vi.fn(() => ({ drive: driveMock })))

vi.mock('driver.js', () => ({ driver: driverMock }))
vi.mock('driver.js/dist/driver.css', () => ({}))

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as Record<string, string>)} />
  },
}))

function item(overrides: Partial<QuotationItem>): QuotationItem {
  return quotationItem({ dymmsa_description: null, is_sold: null, ...overrides })
}

/** Quotation under review with 2 brands and 2 sections. */
function sentQuotation() {
  return quotationWithItems({
    status: 'sent_for_approval',
    quotation_items: [
      separatorRow({ id: 'sep-a', section_label: 'Obra Norte', sort_order: 0 }),
      item({ id: 'p1', etm: 'E-URREA', brand: 'URREA', sort_order: 1 }),
      item({ id: 'p2', etm: 'E-FLUKE', brand: 'FLUKE', sort_order: 2 }),
      separatorRow({ id: 'sep-b', section_label: 'Obra Sur', sort_order: 3 }),
      item({ id: 'p3', etm: 'E-URREA2', brand: 'URREA', sort_order: 4 }),
    ],
  })
}

function dockText() {
  return screen.getByText(/aprobados/).closest('div')?.parentElement?.textContent ?? ''
}

describe('ApprovalClient — filtros y aprobar visibles (#24)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('sin filtro muestra los 3 productos y el botón dice "Aprobar todos"', () => {
    renderWithProviders(<ApprovalClient quotation={sentQuotation()} token="tok-1" />)
    expect(screen.getByText('E-URREA')).toBeInTheDocument()
    expect(screen.getByText('E-FLUKE')).toBeInTheDocument()
    expect(screen.getByText('E-URREA2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /aprobar todos/i })).toBeInTheDocument()
  })

  test('filtro por marca oculta las filas que no pasan y re-etiqueta el botón', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ApprovalClient quotation={sentQuotation()} token="tok-1" />)

    // Opens the brand Select (the first one) and picks FLUKE
    await user.click(screen.getAllByRole('combobox')[0])
    await user.click(await screen.findByRole('option', { name: 'FLUKE' }))

    expect(screen.getByText('E-FLUKE')).toBeInTheDocument()
    expect(screen.queryByText('E-URREA')).not.toBeInTheDocument()
    expect(screen.queryByText('E-URREA2')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /aprobar 1 visible/i })).toBeInTheDocument()
  })

  test('separador de una sección sin ítems visibles se oculta al filtrar', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ApprovalClient quotation={sentQuotation()} token="tok-1" />)

    await user.click(screen.getAllByRole('combobox')[0])
    await user.click(await screen.findByRole('option', { name: 'FLUKE' }))

    // FLUKE only lives in "Obra Norte" → "Obra Sur" disappears
    expect(screen.getByText('Obra Norte')).toBeInTheDocument()
    expect(screen.queryByText('Obra Sur')).not.toBeInTheDocument()
  })

  test('"Aprobar N visibles" solo aprueba lo filtrado; el dock cuenta global', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ApprovalClient quotation={sentQuotation()} token="tok-1" />)

    await user.click(screen.getAllByRole('combobox')[0])
    await user.click(await screen.findByRole('option', { name: 'FLUKE' }))
    await user.click(screen.getByRole('button', { name: /aprobar 1 visible/i }))

    const flukeRow = screen.getByText('E-FLUKE').closest('tr')!
    expect(within(flukeRow).getByText('Aprobado')).toBeInTheDocument()

    // The dock is global: 1 of 3 approved, not 1 of 1.
    expect(dockText()).toMatch(/1.*\/ 3 aprobados/)
  })

  test('vista guiada: los selectores del tour existen y el botón arranca driver.js', async () => {
    // Anti-drift: under review (editable) all 4 tour blocks are present.
    const user = userEvent.setup()
    renderWithProviders(<ApprovalClient quotation={sentQuotation()} token="tok-1" />)
    for (const step of APPROVAL_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }

    await user.click(screen.getByRole('button', { name: /vista guiada/i }))
    expect(driveMock).toHaveBeenCalledOnce()
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(APPROVAL_TOUR.length)
  })

  test('si DYMMSA cambió la cotización (409 stale_items), muestra el aviso para recargar y no lo da por guardado (#157)', async () => {
    const message = 'DYMMSA actualizó esta cotización mientras la revisabas. No se guardó nada: recarga la página.'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message, code: 'stale_items' }), { status: 409 }),
    )
    try {
      const user = userEvent.setup()
      renderWithProviders(<ApprovalClient quotation={sentQuotation()} token="tok-1" />)
      await user.click(screen.getByRole('button', { name: /aprobar todos/i }))
      await user.click(screen.getByRole('button', { name: /guardar avance/i }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(message)
      expect(within(alert).getByRole('button', { name: /recargar página/i })).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith('/api/approve/tok-1', expect.objectContaining({ method: 'POST' }))
      // No "saved progress" banner: nothing was written.
      expect(screen.queryByText(/tienes avance guardado/i)).not.toBeInTheDocument()
    } finally {
      fetchMock.mockRestore()
    }
  })

  test('el aviso de recargar se quita en cuanto un guardado sale bien (review PR #166)', async () => {
    const message = 'DYMMSA actualizó esta cotización mientras la revisabas. No se guardó nada: recarga la página.'
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ message, code: 'stale_items' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
    try {
      const user = userEvent.setup()
      renderWithProviders(<ApprovalClient quotation={sentQuotation()} token="tok-1" />)
      await user.click(screen.getByRole('button', { name: /aprobar todos/i }))
      await user.click(screen.getByRole('button', { name: /guardar avance/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(message)

      await user.click(screen.getByRole('button', { name: /guardar avance/i }))
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(screen.queryByText(message)).not.toBeInTheDocument())
    } finally {
      fetchMock.mockRestore()
    }
  })

  test('colores de sección: rotan por índice y el override guardado gana (issue #73)', () => {
    const quotation = sentQuotation()
    // sep-b carries a manual override; sep-a stays automatic.
    quotation.quotation_items = quotation.quotation_items.map((item) =>
      item.id === 'sep-b' ? { ...item, separator_color: 'rose' } : item,
    )
    renderWithProviders(<ApprovalClient quotation={quotation} token="tok-1" />)

    const rowA = screen.getByText('Obra Norte').closest('tr')!
    const rowB = screen.getByText('Obra Sur').closest('tr')!
    // First separator → first palette color; override → its exact tone.
    expect(rowA.className).toContain(SEPARATOR_PALETTE[SEPARATOR_COLOR_KEYS[0]].row)
    expect(rowB.className).toContain(SEPARATOR_PALETTE.rose.row)
  })
})
