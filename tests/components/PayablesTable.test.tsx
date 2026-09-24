/** PayablesTable (#100): the "Pagada por" column exists only for an admin (ADR-028). */

import { describe, test, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './helpers/render'
import { PayablesTable, payablesColumns } from '@/components/finance/PayablesTable'

const state = vi.hoisted(() => ({ isAdmin: false }))

vi.mock('@/hooks/usePayables', () => ({
  useDeletePayable: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePayable: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ isAdmin: state.isAdmin, profile: null }) }))

const ROW = {
  id: 'p1', supplier_id: 's1', concept: 'Material', amount: 1500, invoice_date: '2026-09-01', due_date: '2026-10-01',
  status: 'paid' as const, paid_at: '2026-09-10', notes: null, created_at: '', updated_at: '',
  supplier: { id: 's1', name: 'Proveedor X', payment_terms_days: 30 },
  paid_by: { name: 'Diego', at: '2026-09-10T18:00:00Z' },
}
const props = { isLoading: false, onEdit: vi.fn(), sortField: 'due_date' as const, sortDir: 'asc' as const, onSort: vi.fn() }

describe('PayablesTable — columna "Pagada por"', () => {
  test('un member no la ve ni aparece en sus columnas', () => {
    state.isAdmin = false
    renderWithProviders(<PayablesTable payables={[ROW]} {...props} />)
    expect(screen.queryByText('Pagada por')).not.toBeInTheDocument()
    expect(screen.queryByText('Diego')).not.toBeInTheDocument()
    expect(payablesColumns(false).some((c) => c.id === 'paid_by')).toBe(false)
  })

  test('el admin la ve antes de Acciones, con el nombre del que marcó', () => {
    state.isAdmin = true
    renderWithProviders(<PayablesTable payables={[ROW, { ...ROW, id: 'p2', paid_by: null }]} {...props} />)
    expect(screen.getByText('Pagada por')).toBeInTheDocument()
    expect(screen.getByText('Diego')).toBeInTheDocument()
    const ids = payablesColumns(true).map((c) => c.id)
    expect(ids.indexOf('paid_by')).toBe(ids.indexOf('actions') - 1)
  })
})
