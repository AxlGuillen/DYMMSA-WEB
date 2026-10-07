/** Mi semana pay estimate (2026-10-05): every hour at the rate plus the paid Saturday; hidden without a rate. */

import { describe, test, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import { useDiscreteModeStore } from '@/stores/discreteModeStore'
import { WeekPayCard } from '@/components/hours/WeekPayCard'
import { buildWeekView } from '@/lib/timesheet'

const entry = (date: string, clockIn: string, clockOut: string | null) => ({ work_date: date, clock_in: clockIn, clock_out: clockOut })
// 2 × 9 h + an open punch that adds nothing = 18 h.
const week = buildWeekView(
  [entry('2026-09-28', '09:00', '18:00'), entry('2026-09-29', '09:00', '18:00'), entry('2026-09-30', '09:00', null)],
  '2026-09-28',
)

beforeEach(() => resetStores())

describe('WeekPayCard', () => {
  test('tiempo completo: (18 h + 8 h del sábado) × $52 = $1,352', () => {
    renderWithProviders(<WeekPayCard week={week} shift="full_time" rate={52} />)
    expect(screen.getByTestId('week-pay-amount')).toHaveTextContent('$1,352.00')
    expect(screen.getByTestId('week-pay')).toHaveTextContent('18:00 h trabajadas + 8 h del sábado × $52.00 la hora')
  })

  test('sin tarifa no aparece', () => {
    renderWithProviders(<WeekPayCard week={week} shift="full_time" rate={null} />)
    expect(screen.queryByTestId('week-pay')).not.toBeInTheDocument()
  })

  test('en modo discreto el monto se tapa', () => {
    useDiscreteModeStore.setState({ isDiscreteMode: true })
    renderWithProviders(<WeekPayCard week={week} shift="part_time" rate={52} />)
    expect(screen.getByTestId('week-pay-amount')).toHaveTextContent('$•,•••.••')
  })
})
