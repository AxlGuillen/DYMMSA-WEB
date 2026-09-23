/** FinanceOverview (#94): income cards + month closing next to payables, and the Odoo-unavailable state. */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { FinanceOverview } from '@/components/finance/FinanceOverview'
import type { IncomeOverviewResponse } from '@/lib/income'

const PAYABLES_OK = {
  month: '2026-08',
  summary: {
    pendingTotal: 1000, pendingCount: 1, overdueTotal: 500, overdueCount: 1, carryOverTotal: 500, carryOverCount: 1,
    dueSoonTotal: 0, dueSoonCount: 0, paidTotal: 4000, paidCount: 2, weeks: [],
  },
  payables: [],
  pendingTruncated: false,
  paidTruncated: false,
}

const state = vi.hoisted(() => ({
  income: null as IncomeOverviewResponse | null,
  isError: false,
  payablesError: false,
  payablesCached: false,
  mutate: vi.fn(),
}))

vi.mock('@/hooks/usePayables', () => ({
  usePayablesOverview: () => ({
    // A failed refetch keeps the cached data: payablesStale covers that case.
    data: state.payablesError && !state.payablesCached ? undefined : PAYABLES_OK,
    isLoading: false,
    isError: state.payablesError,
  }),
}))

vi.mock('@/hooks/useIncome', () => ({
  useIncomeOverview: () => ({ data: state.income, isLoading: false, isError: state.isError }),
  useRefreshIncome: () => ({ mutate: state.mutate, isPending: false }),
}))

const INCOME_OK: IncomeOverviewResponse = {
  month: '2026-08',
  today: '2026-09-09',
  income: {
    collectedTotal: 10000, collectedCount: 2,
    receivableTotal: 3000, receivableCount: 1,
    overdueTotal: 18781.1, overdueCount: 1,
    creditNotesTotal: 1500, creditNotesCount: 1,
    collectionsTruncated: false,
    receivablesTruncated: false,
    collectionCurrencies: ['USD'],
    receivableCurrencies: [],
    overdueCurrencies: ['USD'],
    creditNoteCurrencies: [],
  },
  creditNotes: [
    {
      id: 887, moveType: 'out_refund', folio: 'RINV/2026/00012', customer: 'Siemens', invoiceDate: '2026-09-01', dueDate: '2026-09-01',
      total: 1500, residual: 1500, currency: 'MXN', paymentState: 'not_paid',
    },
  ],
  collections: [
    { id: 71, folio: 'PAY00068', customer: 'Andritz', date: '2026-08-12', amount: 9000, currency: 'MXN', state: 'paid', memo: null },
    { id: 72, folio: 'PAY00069', customer: 'GE', date: '2026-08-20', amount: 1000, currency: 'USD', state: 'in_process', memo: null },
  ],
  fetchedAt: new Date().toISOString(),
}

describe('FinanceOverview — ingresos', () => {
  beforeEach(() => {
    state.income = INCOME_OK
    state.isError = false
    state.payablesError = false
    state.payablesCached = false
    state.mutate.mockClear()
  })

  test('pinta cobrado, por cobrar, vencido y el cierre real/proyectado', () => {
    renderWithProviders(<FinanceOverview />)
    expect(screen.getByText('Cobrado del mes')).toBeInTheDocument()
    expect(screen.getByText('2 cobros')).toBeInTheDocument()
    expect(screen.getByText('Por cobrar')).toBeInTheDocument()
    expect(screen.getByText('Vencido por cobrar')).toBeInTheDocument()
    // 10 000 cobrado − 4 000 pagado = 6 000 real; − 1 000 pendientes − 500 vencidas de meses previos = 4 500.
    const closing = screen.getByText('Cierre del mes').closest('[data-slot="card"]') ?? screen.getByText('Cierre del mes').parentElement!.parentElement!
    expect(closing).toHaveTextContent(/6,000/)
    expect(closing).toHaveTextContent(/Proyectado \$4,500/)
    // The closing sums the month's collections unconverted, so it carries the same warning.
    expect(closing).toHaveTextContent(/incluye USD sin convertir/)
    expect(screen.getByText(/1 factura al día de hoy — vence hoy o después$/)).toBeInTheDocument()
    expect(screen.getByText(/1 factura al día de hoy — cualquier mes · incluye USD sin convertir/)).toBeInTheDocument()
  })

  test('lista los cobros del mes y marca la moneda extranjera', () => {
    renderWithProviders(<FinanceOverview />)
    expect(screen.getByText('Andritz')).toBeInTheDocument()
    expect(screen.getByText('· PAY00068')).toBeInTheDocument()
    expect(screen.getByText('Incluye USD sin convertir')).toBeInTheDocument()
  })

  test('las notas de crédito se listan aparte y NO bajan el por cobrar ni el vencido (#102)', () => {
    renderWithProviders(<FinanceOverview />)
    const card = screen.getByTestId('credit-notes')
    expect(card).toHaveTextContent('Notas de crédito sin aplicar')
    expect(card).toHaveTextContent('$1,500.00 · 1 nota')
    expect(card).toHaveTextContent('RINV/2026/00012')
    expect(card).toHaveTextContent(/No se resta del por cobrar/)
    // Gross figures, exactly as Odoo lists them.
    expect(screen.getByText('Por cobrar').closest('[data-slot="card"]')).toHaveTextContent('$3,000.00')
    expect(screen.getByText('Vencido por cobrar').closest('[data-slot="card"]')).toHaveTextContent('$18,781.10')
  })

  test('sin notas de crédito la card lo dice en vez de desaparecer', () => {
    state.income = { ...INCOME_OK, creditNotes: [], income: { ...INCOME_OK.income!, creditNotesTotal: 0, creditNotesCount: 0 } }
    renderWithProviders(<FinanceOverview />)
    expect(screen.getByTestId('credit-notes')).toHaveTextContent('Sin notas de crédito sin aplicar en Odoo.')
    expect(screen.getByTestId('credit-notes')).toHaveTextContent('$0.00 · 0 notas')
  })

  test('sin Odoo muestra "Ingresos no disponibles" y sigue mostrando los egresos', () => {
    state.income = {
      month: '2026-08', today: '2026-09-09', income: null, collections: [], creditNotes: [], fetchedAt: null,
      unavailable: { reason: 'odoo_error', message: 'No se pudo leer Odoo; se muestran solo los egresos.' },
    }
    renderWithProviders(<FinanceOverview />)
    expect(screen.getByText('Ingresos no disponibles')).toBeInTheDocument()
    expect(screen.getByText(/solo los egresos/)).toBeInTheDocument()
    expect(screen.queryByText('Cierre del mes')).not.toBeInTheDocument()
    expect(screen.getByText('Pagado en el mes')).toBeInTheDocument()
  })

  test('si el GET falla no pinta $0: muestra el error y deja reintentar', () => {
    state.income = null
    state.isError = true
    renderWithProviders(<FinanceOverview />)
    expect(screen.getByText('Ingresos no disponibles')).toBeInTheDocument()
    expect(screen.getByText(/No se pudieron cargar los ingresos/)).toBeInTheDocument()
    expect(screen.queryByText('Cobrado del mes')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actualizar ingresos' })).toBeInTheDocument()
  })

  test('si falla el GET de egresos no pinta $0: avisa y el cierre se queda sin cifra', () => {
    state.payablesError = true
    renderWithProviders(<FinanceOverview />)
    expect(screen.getByText('Egresos no disponibles')).toBeInTheDocument()
    expect(screen.queryByText('Pendiente del mes')).not.toBeInTheDocument()
    // The closing needs both halves: without payables it shows a dash, never a zero.
    const closing = screen.getByText('Cierre del mes').closest('[data-slot="card"]')!
    expect(closing).toHaveTextContent('—')
    expect(closing).toHaveTextContent(/Necesita los cobros de Odoo/)
    // The vencimientos card must not claim an empty month when the read failed.
    expect(screen.queryByText(/Sin facturas pendientes con vencimiento/)).not.toBeInTheDocument()
    expect(screen.getByText(/esta lista puede estar incompleta/)).toBeInTheDocument()
  })

  test('un refetch fallido con datos en caché los conserva y los marca viejos', () => {
    state.payablesError = true
    state.payablesCached = true
    renderWithProviders(<FinanceOverview />)
    expect(screen.queryByText('Egresos no disponibles')).not.toBeInTheDocument()
    expect(screen.getByText('Pendiente del mes')).toBeInTheDocument()
    expect(screen.getAllByText(/última carga buena/)[0]).toBeInTheDocument()
    // Both halves loaded, so the closing still has a figure.
    const closing = screen.getByText('Cierre del mes').closest('[data-slot="card"]')!
    expect(closing).toHaveTextContent(/6,000/)
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
