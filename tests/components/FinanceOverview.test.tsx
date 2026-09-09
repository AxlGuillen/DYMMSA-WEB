/** FinanceOverview (#94): income cards + month closing next to payables, and the Odoo-unavailable state. */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { FinanceOverview } from '@/components/finance/FinanceOverview'
import type { IncomeOverviewResponse } from '@/lib/income'

const state = vi.hoisted(() => ({
  income: null as IncomeOverviewResponse | null,
  mutate: vi.fn(),
}))

vi.mock('@/hooks/usePayables', () => ({
  usePayablesOverview: () => ({
    data: {
      month: '2026-08',
      summary: {
        pendingTotal: 1000, pendingCount: 1, overdueTotal: 0, overdueCount: 0,
        dueSoonTotal: 0, dueSoonCount: 0, paidTotal: 4000, paidCount: 2, weeks: [],
      },
      payables: [],
    },
    isLoading: false,
  }),
}))

vi.mock('@/hooks/useIncome', () => ({
  useIncomeOverview: () => ({ data: state.income, isLoading: false }),
  useRefreshIncome: () => ({ mutate: state.mutate, isPending: false }),
}))

const INCOME_OK: IncomeOverviewResponse = {
  month: '2026-08',
  today: '2026-09-09',
  income: {
    collectedTotal: 10000, collectedCount: 2,
    receivableTotal: 3000, receivableCount: 1,
    overdueTotal: 18781.1, overdueCount: 1,
    truncated: false,
  },
  collections: [
    { id: 71, folio: 'PAY00068', customer: 'Andritz', date: '2026-08-12', amount: 9000, currency: 'MXN', state: 'paid', memo: null },
    { id: 72, folio: 'PAY00069', customer: 'GE', date: '2026-08-20', amount: 1000, currency: 'USD', state: 'in_process', memo: null },
  ],
  fetchedAt: new Date().toISOString(),
}

describe('FinanceOverview — ingresos', () => {
  beforeEach(() => { state.income = INCOME_OK; state.mutate.mockClear() })

  test('pinta cobrado, por cobrar, vencido y el cierre real/proyectado', () => {
    renderWithProviders(<FinanceOverview />)
    expect(screen.getByText('Cobrado del mes')).toBeInTheDocument()
    expect(screen.getByText('2 cobros')).toBeInTheDocument()
    expect(screen.getByText('Por cobrar')).toBeInTheDocument()
    expect(screen.getByText('Vencido por cobrar')).toBeInTheDocument()
    // 10 000 cobrado − 4 000 pagado = 6 000 real; − 1 000 pendientes = 5 000 proyectado.
    const closing = screen.getByText('Cierre del mes').closest('[data-slot="card"]') ?? screen.getByText('Cierre del mes').parentElement!.parentElement!
    expect(closing).toHaveTextContent(/6,000/)
    expect(closing).toHaveTextContent(/Proyectado \$5,000/)
  })

  test('lista los cobros del mes y marca la moneda extranjera', () => {
    renderWithProviders(<FinanceOverview />)
    expect(screen.getByText('Andritz')).toBeInTheDocument()
    expect(screen.getByText('· PAY00068')).toBeInTheDocument()
    expect(screen.getByText('Incluye USD sin convertir')).toBeInTheDocument()
  })

  test('sin Odoo muestra "Ingresos no disponibles" y sigue mostrando los egresos', () => {
    state.income = {
      month: '2026-08', today: '2026-09-09', income: null, collections: [], fetchedAt: null,
      unavailable: { reason: 'odoo_error', message: 'No se pudo leer Odoo; se muestran solo los egresos.' },
    }
    renderWithProviders(<FinanceOverview />)
    expect(screen.getByText('Ingresos no disponibles')).toBeInTheDocument()
    expect(screen.getByText(/solo los egresos/)).toBeInTheDocument()
    expect(screen.queryByText('Cierre del mes')).not.toBeInTheDocument()
    expect(screen.getByText('Pagado en el mes')).toBeInTheDocument()
  })

  test('Actualizar dispara el refresh del mes visible', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FinanceOverview />)
    const header = screen.getByTestId('income-header')
    expect(within(header).getByText(/Actualizado hace/)).toBeInTheDocument()
    await user.click(within(header).getByRole('button', { name: 'Actualizar ingresos' }))
    expect(state.mutate).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), expect.anything())
  })
})
