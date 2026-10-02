/** PayrollView (#123): the cut as a grid, what counts, and what a closed cut still allows. */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from './helpers/render'
import { PayrollView } from '@/components/payroll/PayrollView'
import { buildPayrollView } from '@/lib/payroll'
import type { PayrollDay, PayrollEmployee, PayrollPeriod } from '@/types/database'

const SAT = '2026-09-19'
const juan: PayrollEmployee = { id: 'e1', name: 'Juan Taller', profile_id: null, shift: 'full_time', active: true, created_at: '', updated_at: '' }
const day = (date: string, minutes: number, over: Partial<PayrollDay> = {}): PayrollDay => ({
  id: date, employee_id: 'e1', work_date: date, worked_minutes: minutes, missed_minutes: 0, note: null,
  source: 'sheet', status: 'confirmed', created_at: '', updated_at: '', ...over,
})

const state = vi.hoisted(() => ({
  period: null as PayrollPeriod | null,
  employees: [] as PayrollEmployee[],
  days: [] as PayrollDay[],
  closed: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('@/lib/format', async (original) => {
  const real = await original<typeof import('@/lib/format')>()
  // Only "now" is pinned; an explicit date still converts for real.
  return { ...real, todayInMexico: (date?: Date) => (date ? real.todayInMexico(date) : '2026-09-23') }
})

vi.mock('@/hooks/usePayroll', () => ({
  usePayrollPeriod: (start: string) => ({ data: buildPayrollView(start, state.employees, state.days, state.period), isLoading: false, isError: false }),
  usePayrollEmployees: () => ({ data: state.employees }),
  usePrefillPayroll: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmPayroll: () => ({ mutateAsync: state.confirm, isPending: false }),
  useSetPayrollClosed: () => ({ mutateAsync: state.closed, isPending: false }),
  useSavePayrollDay: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSavePayrollEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useProfile', () => ({ useProfiles: () => ({ data: [] }) }))

describe('PayrollView', () => {
  beforeEach(() => {
    state.period = null
    state.employees = [juan]
    state.days = [day(SAT, 360), day('2026-09-21', 690), day('2026-09-22', 480, { status: 'draft' })]
    state.closed.mockReset().mockResolvedValue({})
    state.confirm.mockReset().mockResolvedValue({ confirmed: 1 })
  })

  test('abre en el corte de hoy (sábado→viernes) y pinta horas, borradores y el equivalente', () => {
    renderWithProviders(<PayrollView />)
    expect(screen.getByRole('button', { name: /Juan Taller, Sáb/ }).textContent).toContain('06:00')
    expect(screen.getByRole('button', { name: /Juan Taller, Lun/ }).textContent).toContain('11:30')
    expect(screen.getByRole('button', { name: /Juan Taller, Mar/ }).textContent).toContain('borrador')
    // 8:00 normal + 3:30 extra + 6:00 × 2; the draft Tuesday does not count.
    expect(screen.getAllByText('23:30').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Confirmar borradores (1)' })).toBeTruthy()
    // A draft left behind would be lost hours: closing waits for it.
    expect((screen.getByRole('button', { name: 'Cerrar corte' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('sin borradores se puede cerrar el corte que está en pantalla', () => {
    state.days = [day(SAT, 360)]
    renderWithProviders(<PayrollView />)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar corte' }))
    expect(state.closed).toHaveBeenCalledWith({ start: SAT, closed: true })
  })

  test('corte cerrado: celdas bloqueadas, sin acciones de captura y solo queda reabrir', () => {
    state.days = [day(SAT, 360)]
    // 01:00Z on the 26th is still Friday the 25th in Mexico: the day shown is the local one.
    state.period = { start_date: SAT, status: 'closed', closed_at: '2026-09-26T01:00:00Z', closed_by_name: 'Axl', reopened_at: null, reopened_by_name: null }
    renderWithProviders(<PayrollView />)
    expect(screen.getByText('Cerrado')).toBeTruthy()
    expect(screen.getByText(/Cerrado por Axl el .*25/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Juan Taller, Sáb/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Traer de Horas' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cerrar corte' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reabrir corte' }))
    expect(state.closed).toHaveBeenCalledWith({ start: SAT, closed: false })
  })

  test('sin empleados guía a darlos de alta', () => {
    state.employees = []
    state.days = []
    renderWithProviders(<PayrollView />)
    expect(screen.getByText(/Aún no hay empleados en Nómina/)).toBeTruthy()
  })
})
