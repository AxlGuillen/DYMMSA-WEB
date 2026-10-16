/** Clientes screens (#145): list filters, range in the URL, detail contact vs. export, and the tours' anchors. */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders, setupUser } from './helpers/render'
import { resetStores } from './helpers/stores'
import { useDiscreteModeStore } from '@/stores/discreteModeStore'
import { CustomersList } from '@/components/customers/CustomersList'
import { CustomerDetail } from '@/components/customers/CustomerDetail'
import CustomersPage from '@/app/dashboard/clientes/page'
import { CUSTOMER_DETAIL_TOUR, CUSTOMERS_LIST_TOUR } from '@/lib/tours/customers'
import { ApiError } from '@/lib/fetch-json'
import type { CustomerDetailResponse, CustomersResponse } from '@/lib/customers'

const nav = vi.hoisted(() => ({ query: '', replace: vi.fn() }))
const hooks = vi.hoisted(() => ({
  list: { data: undefined as unknown, isLoading: false, isError: false },
  detail: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown },
  refresh: vi.fn(),
}))
const excel = vi.hoisted(() => ({ generate: vi.fn(() => new Blob()), download: vi.fn() }))
const driveMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => '/dashboard/clientes',
}))
vi.mock('@/hooks/useCustomers', () => ({
  useCustomers: () => hooks.list,
  useCustomer: () => hooks.detail,
  useRefreshCustomers: () => ({ mutate: hooks.refresh, isPending: false }),
}))
vi.mock('@/lib/excel/statement', () => ({
  generateStatementExcel: excel.generate,
  downloadStatementExcel: excel.download,
}))
vi.mock('driver.js', () => ({ driver: vi.fn(() => ({ drive: driveMock })) }))
vi.mock('driver.js/dist/driver.css', () => ({}))

const RANGE = { from: null, to: '2026-10-31', filter: 'all' as const }

const LIST: CustomersResponse = {
  today: '2026-10-15',
  range: RANGE,
  customers: [
    { id: 55, name: 'FieldCore', city: 'Querétaro', overdue: 500, upcoming: 0, total: 500, openInvoices: 1, creditNotes: 0, creditNoteCount: 0, daysToPay: null, currencies: ['USD'] },
    { id: 24, name: 'Andritz', city: 'Morelia', overdue: 100, upcoming: 40, total: 140, openInvoices: 2, creditNotes: 30, creditNoteCount: 1, daysToPay: 42, currencies: [] },
    // Owes nothing in the window but holds an unapplied credit note: "Solo con saldo" keeps it.
    { id: 8, name: 'Carso', city: null, overdue: 0, upcoming: 0, total: 0, openInvoices: 0, creditNotes: 12, creditNoteCount: 1, daysToPay: null, currencies: [] },
    { id: 7, name: 'Bosch', city: null, overdue: 0, upcoming: 0, total: 0, openInvoices: 0, creditNotes: 0, creditNoteCount: 0, daysToPay: null, currencies: [] },
  ],
  totals: { overdue: 600, upcoming: 40, total: 640, openInvoices: 3, creditNotes: 42, currencies: ['USD'] },
  reason: null,
  truncated: false,
  fetchedAt: new Date().toISOString(),
}

const DETAIL: CustomerDetailResponse = {
  today: '2026-10-15',
  range: RANGE,
  customer: { id: 24, name: 'Andritz', city: 'Morelia', phone: '443 000 0000', email: 'pagos@andritz.test', vat: 'AND010101AAA', daysToPay: 42 },
  statement: {
    lines: [
      { id: 1, folio: 'F00387', invoiceDate: '2026-08-11', dueDate: '2026-09-10', total: 1160, residual: 100, currency: 'MXN', status: 'overdue', days: 35 },
      { id: 2, folio: 'F00390', invoiceDate: '2026-10-01', dueDate: '2026-10-20', total: 40, residual: 40, currency: 'USD', status: 'upcoming', days: 5 },
    ],
    totals: { overdue: 100, overdueCount: 1, upcoming: 40, upcomingCount: 1, total: 140, count: 2 },
    currencies: ['USD'],
  },
  creditNotes: { total: 30, count: 1, lines: [{ id: 90, folio: 'RINV/2026/00012', date: '2026-09-01', residual: 30, currency: 'MXN' }], currencies: [] },
  sales: [{ id: 9, folio: 'S00041', date: '2026-10-02', total: 1160, state: 'sale', invoiceStatus: 'to invoice' }],
  payments: [{ id: 71, folio: 'PAY00068', date: '2026-10-01', amount: 580, currency: 'MXN', memo: 'F00387' }],
  reason: null,
  truncated: false,
  fetchedAt: new Date().toISOString(),
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStores()
  nav.query = ''
  hooks.list = { data: LIST, isLoading: false, isError: false }
  hooks.detail = { data: DETAIL, isLoading: false, isError: false, error: null }
})

describe('CustomersList', () => {
  test('por defecto esconde a quien no debe nada; al destildar "Solo con saldo" aparece', async () => {
    const user = setupUser()
    renderWithProviders(<CustomersList />)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('link').map((a) => a.textContent)).toEqual(['FieldCore', 'Andritz', 'Carso'])

    await user.click(screen.getByRole('checkbox', { name: /solo con saldo/i }))
    expect(within(table).getByRole('link', { name: 'Bosch' })).toBeInTheDocument()
  })

  test('la búsqueda filtra por nombre o ciudad y el pie suma solo lo visible', async () => {
    const user = setupUser()
    renderWithProviders(<CustomersList />)
    await user.type(screen.getByRole('textbox', { name: /buscar cliente/i }), 'morelia')
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('link').map((a) => a.textContent)).toEqual(['Andritz'])
    expect(within(table).getByText('Total (1 cliente)')).toBeInTheDocument()
  })

  test('una búsqueda sin resultados lo dice (no culpa al rango)', async () => {
    const user = setupUser()
    renderWithProviders(<CustomersList />)
    await user.type(screen.getByRole('textbox', { name: /buscar cliente/i }), 'zzz')
    expect(screen.getByText('Ningún cliente coincide con la búsqueda.')).toBeInTheDocument()
  })

  test('otra moneda: insignia en la fila y aviso en el total (ADR-027 §7)', () => {
    renderWithProviders(<CustomersList />)
    const row = screen.getByRole('link', { name: 'FieldCore' }).closest('tr')!
    expect(within(row).getByText('USD')).toBeInTheDocument()
    expect(screen.getByText(/incluye USD sin convertir/)).toBeInTheDocument()
  })

  test('el link al cliente lleva el rango para que el detalle abra en el mismo periodo', () => {
    nav.query = 'from=2026-10-01&to=2026-10-31&filter=overdue'
    renderWithProviders(<CustomersList />)
    expect(screen.getByRole('link', { name: 'Andritz' })).toHaveAttribute(
      'href',
      '/dashboard/clientes/24?from=2026-10-01&to=2026-10-31&filter=overdue',
    )
  })

  test('cambiar una fecha reescribe la URL; un "desde" posterior al "hasta" se rechaza', () => {
    nav.query = 'from=&to=2026-10-31&filter=all'
    renderWithProviders(<CustomersList />)
    fireEvent.change(screen.getByLabelText('Vence desde'), { target: { value: '2026-10-01' } })
    expect(nav.replace).toHaveBeenCalledWith('/dashboard/clientes?from=2026-10-01&to=2026-10-31&filter=all', { scroll: false })

    nav.replace.mockClear()
    fireEvent.change(screen.getByLabelText('Vence desde'), { target: { value: '2026-11-15' } })
    expect(nav.replace).not.toHaveBeenCalled()
    // The typed value stays in the input and the reason is shown, instead of snapping back in silence.
    expect(screen.getByLabelText('Vence desde')).toHaveValue('2026-11-15')
    expect(screen.getByRole('alert')).toHaveTextContent(/no puede ser posterior/)
  })

  test('un año a medio teclear (0002…) no llega a la URL; al completarlo sí', () => {
    nav.query = 'from=&to=&filter=all'
    renderWithProviders(<CustomersList />)
    fireEvent.change(screen.getByLabelText('Vence hasta'), { target: { value: '0002-10-31' } })
    expect(nav.replace).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Vence hasta'), { target: { value: '2026-10-31' } })
    expect(nav.replace).toHaveBeenCalledWith('/dashboard/clientes?from=&to=2026-10-31&filter=all', { scroll: false })
  })

  test('Odoo sin configurar → aviso en lugar de tabla', () => {
    hooks.list = { data: { ...LIST, customers: null, totals: null, reason: 'not_configured' }, isLoading: false, isError: false }
    renderWithProviders(<CustomersList />)
    expect(screen.getByText(/no está configurada/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('Actualizar purga y vuelve a leer', async () => {
    const user = setupUser()
    renderWithProviders(<CustomersList />)
    await user.click(screen.getByRole('button', { name: /actualizar clientes/i }))
    expect(hooks.refresh).toHaveBeenCalledOnce()
  })
})

describe('CustomerDetail', () => {
  test('el contacto (con RFC) se ve en pantalla; el Excel recibe solo nombre, rango y facturas', async () => {
    const user = setupUser()
    renderWithProviders(<CustomerDetail id="24" />)
    expect(screen.getByText('AND010101AAA')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /pagos@andritz.test/ })).toHaveAttribute('href', 'mailto:pagos@andritz.test')

    await user.click(screen.getByRole('button', { name: /excel/i }))
    expect(excel.generate).toHaveBeenCalledWith({
      customerName: 'Andritz',
      range: RANGE,
      today: '2026-10-15',
      lines: DETAIL.statement!.lines,
      totals: DETAIL.statement!.totals,
      currencies: ['USD'],
      truncated: false,
    })
    expect(excel.download).toHaveBeenCalledWith(expect.any(Blob), 'Andritz', '2026-10-15')
  })

  test('lo impreso: encabezado con nombre y periodo, el contacto queda fuera', () => {
    renderWithProviders(<CustomerDetail id="24" />)
    const printHeader = screen.getByRole('heading', { name: 'Estado de cuenta', level: 1 }).parentElement!
    expect(printHeader).toHaveClass('hidden', 'print:block')
    expect(printHeader).toHaveTextContent('Andritz')
    expect(printHeader).toHaveTextContent(/Vence hasta el/)
    expect(printHeader).not.toHaveTextContent('AND010101AAA')
    expect(screen.getByText('AND010101AAA').closest('[data-tour="cli-contact"]')).toHaveClass('print:hidden')
  })

  test('la línea en dólares lleva su moneda y las tarjetas avisan que se suma sin convertir', () => {
    renderWithProviders(<CustomerDetail id="24" />)
    const row = screen.getByRole('cell', { name: 'F00390' }).closest('tr')!
    expect(within(row).getByText('USD')).toBeInTheDocument()
    expect(screen.getAllByText(/incluye USD sin convertir/).length).toBeGreaterThan(0)
  })

  test('modo discreto enmascara en pantalla pero lo impreso lleva el monto real', () => {
    useDiscreteModeStore.setState({ isDiscreteMode: true })
    renderWithProviders(<CustomerDetail id="24" />)
    const row = screen.getByRole('cell', { name: 'F00387' }).closest('tr')!
    expect(within(row).getAllByText('$•,•••.••')[0]).toHaveClass('print:hidden')
    expect(within(row).getByText('$1,160.00')).toHaveClass('hidden', 'print:inline')
  })

  test('404 → "Cliente no encontrado" con regreso a la lista', () => {
    hooks.detail = { data: undefined, isLoading: false, isError: true, error: new ApiError('Cliente no encontrado', 'VALIDATION', undefined, 404) }
    renderWithProviders(<CustomerDetail id="999" />)
    expect(screen.getByText(/Cliente no encontrado/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /clientes/i })).toHaveAttribute('href', expect.stringMatching(/^\/dashboard\/clientes\?/))
  })

  test('sin facturas en el rango: Excel e Imprimir deshabilitados', () => {
    hooks.detail = {
      data: { ...DETAIL, statement: { lines: [], totals: { overdue: 0, overdueCount: 0, upcoming: 0, upcomingCount: 0, total: 0, count: 0 }, currencies: [] } },
      isLoading: false, isError: false, error: null,
    }
    renderWithProviders(<CustomerDetail id="24" />)
    expect(screen.getByRole('button', { name: /excel/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /imprimir/i })).toBeDisabled()
    expect(screen.getByText('Sin facturas abiertas en este rango.')).toBeInTheDocument()
  })
})

describe('Vistas guiadas — Clientes', () => {
  test('anti-drift: los selectores de la lista existen en la página', () => {
    renderWithProviders(<CustomersPage />)
    for (const step of CUSTOMERS_LIST_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('anti-drift: los selectores del detalle existen con el fixture completo', () => {
    renderWithProviders(<CustomerDetail id="24" />)
    for (const step of CUSTOMER_DETAIL_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })
})
