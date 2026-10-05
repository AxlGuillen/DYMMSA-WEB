/** Admin team overview (2026-10-05): office from the clock with pay, workshop from Nómina, everyone or one person. */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import { TeamHoursOverview } from '@/components/hours/TeamHoursOverview'
import type { TeamHoursResponse } from '@/hooks/useTeamHours'

const day = (date: string, minutes: number, status: 'met' | 'short' | 'off' = 'met') => ({ date, minutes, open: 0, status })
const DATA: TeamHoursResponse = {
  start: '2026-09-28',
  end: '2026-10-04',
  office: [{
    id: 'u-tania', name: 'Tania', avatarUrl: null, shift: 'part_time', minutes: 360, target: 1200,
    days: [day('2026-09-28', 240), day('2026-09-29', 120, 'short'), ...['30', '01', '02', '03', '04'].map((d) => day(`2026-${d === '30' ? '09' : '10'}-${d}`, 0, 'off'))],
    pay: { rate: 52, workedMinutes: 360, saturdayHours: 4, paidHours: 10, amount: 520 },
  }],
  workshop: [{
    id: 'e-jose', name: 'José', shift: 'full_time', source: 'payroll', minutes: 900, drafts: 1,
    days: [600, 0, 0, 0, 0, 300, 0].map((m, i) => ({ date: `2026-09-${28 + i}`, minutes: m, draft: i === 5 })),
  }],
  totals: { officeMinutes: 360, officePay: 520, workshopMinutes: 900 },
  leaders: {
    week: [{ id: 'e-jose', name: 'José', area: 'workshop', minutes: 900 }, { id: 'u-tania', name: 'Tania', area: 'office', minutes: 360 }],
    month: { month: '2026-10', ranking: [] },
  },
}

vi.mock('@/hooks/useTeamHours', () => ({ useTeamHours: () => ({ data: DATA, isLoading: false, isError: false }) }))

beforeEach(() => resetStores())

describe('TeamHoursOverview', () => {
  test('todo el equipo: oficina con pago y totales, taller con borradores', () => {
    renderWithProviders(<TeamHoursOverview />)
    const office = screen.getByTestId('team-office')
    expect(within(office).getByText('Tania')).toBeInTheDocument()
    expect(within(office).getByText('04:00')).toHaveClass('text-green-700')
    expect(within(office).getByText('02:00')).toHaveClass('text-red-600')
    expect(screen.getByTestId('team-office-pay')).toHaveTextContent('$520.00')

    const workshop = screen.getByTestId('team-workshop')
    expect(within(workshop).getByText('José')).toBeInTheDocument()
    expect(within(workshop).getByTitle('Borrador: falta confirmarlo en Nómina')).toHaveTextContent('05:00')
    expect(within(workshop).getAllByText('15:00', { selector: 'td' })).toHaveLength(2)
  })

  test('por persona: elegir a alguien del taller oculta la oficina y los totales', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TeamHoursOverview />)
    await user.click(screen.getByLabelText('Persona'))
    await user.click(await screen.findByRole('option', { name: 'José · taller' }))
    expect(screen.queryByTestId('team-office')).not.toBeInTheDocument()
    expect(screen.getByTestId('team-workshop')).toHaveTextContent('José')
    expect(screen.queryByText('Total taller')).not.toBeInTheDocument()
  })
})

describe('TeamHoursOverview — más horas', () => {
  test('la semana muestra el ranking con su área; el mes vacío lo dice', () => {
    renderWithProviders(<TeamHoursOverview />)
    const week = screen.getByTestId('leaders-week')
    expect(week).toHaveTextContent('Más horas esta semana')
    expect(within(week).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1JoséTaller15:00 h', '2TaniaOficina06:00 h'])
    const month = screen.getByTestId('leaders-month')
    expect(month).toHaveTextContent(/Más horas en octubre de 2026/)
    expect(month).toHaveTextContent('Nadie tiene horas registradas todavía.')
  })
})
