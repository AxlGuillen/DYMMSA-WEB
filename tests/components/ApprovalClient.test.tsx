/**
 * Página pública de aprobación (issue #24): filtros por marca/proyecto y
 * "aprobar visibles" contextual. El API no se toca aquí — no disparamos envío.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { quotationWithItems, quotationItem, separatorRow } from './helpers/fixtures'
import { ApprovalClient } from '@/app/approve/[token]/ApprovalClient'
import type { QuotationItem } from '@/types/database'

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as Record<string, string>)} />
  },
}))

function item(overrides: Partial<QuotationItem>): QuotationItem {
  return quotationItem({ dymmsa_description: null, is_sold: null, ...overrides })
}

/** Cotización en revisión con 2 marcas y 2 secciones. */
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

    // Abre el Select de marca (el primero) y elige FLUKE
    await user.click(screen.getAllByRole('combobox')[0])
    await user.click(await screen.findByRole('option', { name: 'FLUKE' }))

    expect(screen.getByText('E-FLUKE')).toBeInTheDocument()
    expect(screen.queryByText('E-URREA')).not.toBeInTheDocument()
    expect(screen.queryByText('E-URREA2')).not.toBeInTheDocument()
    // Botón contextual
    expect(screen.getByRole('button', { name: /aprobar 1 visible/i })).toBeInTheDocument()
  })

  test('separador de una sección sin ítems visibles se oculta al filtrar', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ApprovalClient quotation={sentQuotation()} token="tok-1" />)

    await user.click(screen.getAllByRole('combobox')[0])
    await user.click(await screen.findByRole('option', { name: 'FLUKE' }))

    // FLUKE solo vive en "Obra Norte" → "Obra Sur" desaparece
    expect(screen.getByText('Obra Norte')).toBeInTheDocument()
    expect(screen.queryByText('Obra Sur')).not.toBeInTheDocument()
  })

  test('"Aprobar N visibles" solo aprueba lo filtrado; el dock cuenta global', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ApprovalClient quotation={sentQuotation()} token="tok-1" />)

    await user.click(screen.getAllByRole('combobox')[0])
    await user.click(await screen.findByRole('option', { name: 'FLUKE' }))
    await user.click(screen.getByRole('button', { name: /aprobar 1 visible/i }))

    // Solo la fila FLUKE quedó "Aprobado"
    const flukeRow = screen.getByText('E-FLUKE').closest('tr')!
    expect(within(flukeRow).getByText('Aprobado')).toBeInTheDocument()

    // El dock (global) muestra 1 de 3 aprobados, no 1 de 1
    expect(dockText()).toMatch(/1.*\/ 3 aprobados/)
  })
})
