/** Finance tours (#120, ADR-024): `data-tour` anti-drift on the overview and the payables page. */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import FinancePage from '@/app/dashboard/finance/page'
import PayablesPage from '@/app/dashboard/finance/payables/page'
import { FINANCE_OVERVIEW_TOUR } from '@/lib/tours/finance-overview'
import { PAYABLES_TOUR } from '@/lib/tours/payables'
import type { IncomeOverviewResponse } from '@/lib/income'

const driveMock = vi.hoisted(() => vi.fn())
const driverMock = vi.hoisted(() => vi.fn(() => ({ drive: driveMock })))

vi.mock('driver.js', () => ({ driver: driverMock }))
vi.mock('driver.js/dist/driver.css', () => ({}))

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

// Every income block present, credit notes included: the tour must find all six anchors.
const INCOME_OK: IncomeOverviewResponse = {
  month: '2026-08',
  today: '2026-09-09',
  income: {
    collectedTotal: 10000, collectedCount: 2, receivableTotal: 3000, receivableCount: 1,
    overdueTotal: 18781.1, overdueCount: 1, creditNotesTotal: 0, creditNotesCount: 0,
    collectionsTruncated: false, receivablesTruncated: false,
    collectionCurrencies: [], receivableCurrencies: [], overdueCurrencies: [], creditNoteCurrencies: [],
  },
  creditNotes: [],
  collections: [],
  fetchedAt: new Date().toISOString(),
}

vi.mock('@/hooks/usePayables', () => ({
  usePayablesOverview: () => ({ data: PAYABLES_OK, isLoading: false, isError: false }),
  usePayables: () => ({ data: { data: [], count: 0, page: 1, pageSize: 20, totalPages: 1 }, isLoading: false }),
}))
vi.mock('@/hooks/useIncome', () => ({
  useIncomeOverview: () => ({ data: INCOME_OK, isLoading: false, isError: false }),
  useRefreshIncome: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({ data: { data: [], count: 0, page: 1, pageSize: 100, totalPages: 1 } }),
}))
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ isAdmin: true, profile: null, isLoading: false }),
}))
vi.mock('@/components/finance/PayablesTable', () => ({
  PayablesTable: () => null,
  payablesColumns: () => [],
}))
vi.mock('@/components/finance/PayableForm', () => ({ PayableForm: () => null }))

describe('Vista guiada — Finanzas overview', () => {
  beforeEach(() => vi.clearAllMocks())

  test('anti-drift: los 6 selectores existen', () => {
    renderWithProviders(<FinancePage />)
    for (const step of FINANCE_OVERVIEW_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('el cierre se ancla en la propia Card (sigue siendo el ítem del grid) y los pasos van en orden de pantalla', () => {
    renderWithProviders(<FinancePage />)
    expect(document.querySelector('[data-tour="fin-closing"]')).toHaveAttribute('data-slot', 'card')
    const order = FINANCE_OVERVIEW_TOUR.map((s) => document.querySelector(s.selector)!)
    for (let i = 1; i < order.length; i++) {
      // DOCUMENT_POSITION_FOLLOWING: each step's block comes after the previous one's.
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `paso ${i}`).toBeTruthy()
    }
  })

  test('el botón arranca driver.js con los 6 bloques', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FinancePage />)
    await user.click(screen.getByRole('button', { name: /vista guiada/i }))
    expect(driveMock).toHaveBeenCalledOnce()
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(FINANCE_OVERVIEW_TOUR.length)
  })
})

describe('Vista guiada — Facturas por pagar', () => {
  beforeEach(() => vi.clearAllMocks())

  test('anti-drift: los 3 selectores existen', () => {
    renderWithProviders(<PayablesPage />)
    for (const step of PAYABLES_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('el botón arranca driver.js con los 3 bloques', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PayablesPage />)
    await user.click(screen.getByRole('button', { name: /vista guiada/i }))
    expect(driverMock.mock.calls[0][0].steps).toHaveLength(PAYABLES_TOUR.length)
  })
})
