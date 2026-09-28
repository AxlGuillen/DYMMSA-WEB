/** WeekChart (#101): the headline compares the week with the person's shift; the SVG itself is recharts. */

import { describe, test, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './helpers/render'
import { WeekChart } from '@/components/hours/WeekChart'
import { TrendChart } from '@/components/hours/TrendChart'
import { buildWeekView, buildWeeklyTrend } from '@/lib/timesheet'

// recharts needs a measured container; jsdom gives none, so the bars are stubbed and the
// header — where every number lives — is what gets asserted.
vi.mock('@/components/hours/WeekBars', () => ({ default: () => <div data-testid="week-bars" /> }))
vi.mock('@/components/hours/TrendBars', () => ({ default: () => <div data-testid="trend-bars" /> }))

const entry = (date: string, clockIn: string, clockOut: string | null) => ({ work_date: date, clock_in: clockIn, clock_out: clockOut })
const week = buildWeekView(
  [entry('2026-08-31', '09:00', '17:00'), entry('2026-09-01', '09:00', '17:00'), entry('2026-09-02', '09:00', null)],
  '2026-08-31',
)

describe('WeekChart', () => {
  test('tiempo completo: total contra 40 h, faltante y la jornada en el encabezado', () => {
    renderWithProviders(<WeekChart week={week} shift="full_time" />)
    const card = screen.getByTestId('week-chart')
    expect(card).toHaveTextContent('Tiempo completo · 8 h')
    expect(screen.getByTestId('week-chart-total')).toHaveTextContent('16:00 / 40 h')
    expect(card).toHaveTextContent('Faltan 24:00 · 40%')
    expect(card).toHaveTextContent('1 checada sin salida')
  })

  test('medio tiempo: 16 h de 20 h aún no cumple; con 24 h sí, y el porcentaje pasa de 100', () => {
    const { unmount } = renderWithProviders(<WeekChart week={week} shift="part_time" />)
    expect(screen.getByTestId('week-chart')).toHaveTextContent('Faltan 04:00 · 80%')
    unmount()

    const fullWeek = buildWeekView(
      [entry('2026-08-31', '09:00', '17:00'), entry('2026-09-01', '09:00', '17:00'), entry('2026-09-02', '09:00', '17:00')],
      '2026-08-31',
    )
    renderWithProviders(<WeekChart week={fullWeek} shift="part_time" />)
    expect(screen.getByTestId('week-chart')).toHaveTextContent('Cumple · 120%')
  })

  test('sin jornada: no hay objetivo ni badge; el admin ve la liga a Equipo', () => {
    renderWithProviders(<WeekChart week={week} shift={null} canAssignShift />)
    const card = screen.getByTestId('week-chart')
    expect(card).toHaveTextContent('Sin jornada asignada')
    expect(screen.getByRole('link', { name: 'asignar en Equipo' })).toHaveAttribute('href', '/dashboard/hours/team')
    expect(screen.getByTestId('week-chart-total')).toHaveTextContent('16:00')
    expect(card).not.toHaveTextContent('/ 40 h')
    expect(card).not.toHaveTextContent('Cumple')
  })
})

describe('TrendChart', () => {
  test('promedio de las semanas y estado de error', () => {
    const trend = buildWeeklyTrend([entry('2026-08-31', '09:00', '17:00')], '2026-08-31', 4)
    const { unmount } = renderWithProviders(<TrendChart trend={trend} shift="full_time" currentStart="2026-08-31" />)
    const card = screen.getByTestId('trend-chart')
    expect(card).toHaveTextContent('Últimas 4 semanas')
    // 8 h over 4 weeks.
    expect(card).toHaveTextContent('Promedio 02:00 h')
    unmount()

    renderWithProviders(<TrendChart trend={undefined} shift="full_time" currentStart="2026-08-31" isError />)
    expect(screen.getByTestId('trend-chart')).toHaveTextContent('No se pudo cargar la tendencia')
  })
})
