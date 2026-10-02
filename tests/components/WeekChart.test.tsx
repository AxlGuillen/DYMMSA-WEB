/** WeekChart (#101): the headline compares the week with the person's shift; the SVG itself is recharts. */

import { describe, test, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './helpers/render'
import { WeekChart } from '@/components/hours/WeekChart'
import { TrendChart } from '@/components/hours/TrendChart'
import { buildWeekView, buildWeeklyTrend } from '@/lib/timesheet'

// recharts needs a measured container; jsdom gives none, so the bars are stubbed and the
// header — where every number lives — is what gets asserted.
vi.mock('@/components/hours/WeekBars', () => ({
  default: ({ data }: { data: { status: string }[] }) => <div data-testid="week-bars" data-statuses={data.map((d) => d.status).join(',')} />,
}))
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

  test('avisa de las semanas con días justificados solo cuando hay jornada contra la cual medir', () => {
    const excuses = new Map([['2026-08-26', 'holiday']] as const)
    const trend = buildWeeklyTrend([], '2026-08-31', 2, { shift: 'full_time', excuses })
    const { unmount } = renderWithProviders(<TrendChart trend={trend} shift="full_time" currentStart="2026-08-31" />)
    expect(screen.getByTestId('trend-chart-excused')).toHaveTextContent('1 semana con días justificados')
    unmount()

    renderWithProviders(<TrendChart trend={trend} shift={null} currentStart="2026-08-31" />)
    expect(screen.queryByTestId('trend-chart-excused')).toBeNull()
  })
})

describe('WeekChart — días justificados (meeting 2026-10-01)', () => {
  test('un feriado del equipo baja el objetivo a 32 h y avisa; el día propio se suma', () => {
    const excused = [
      { id: 'x1', work_date: '2026-09-03', user_id: null, kind: 'holiday' as const, note: null, created_by: null, created_at: '' },
      { id: 'x2', work_date: '2026-09-04', user_id: 'u-otro', kind: 'holiday' as const, note: null, created_by: null, created_at: '' },
    ]
    renderWithProviders(<WeekChart week={week} shift="full_time" excused={excused} userId="u-yo" />)
    expect(screen.getByTestId('week-chart-total')).toHaveTextContent('16:00 / 32 h')
    expect(screen.getByTestId('week-chart')).toHaveTextContent('Faltan 16:00 · 50%')
    expect(screen.getByTestId('week-chart-excused')).toHaveTextContent('1 día justificado')
  })

  test('cada barra lleva su estado: cumplió, sin salida, justificado', async () => {
    const excused = [{ id: 'x1', work_date: '2026-09-03', user_id: null, kind: 'holiday' as const, note: null, created_by: null, created_at: '' }]
    renderWithProviders(<WeekChart week={week} shift="full_time" excused={excused} userId="u-yo" />)
    const bars = await screen.findByTestId('week-bars')
    expect(bars.dataset.statuses?.split(',').slice(0, 4)).toEqual(['met', 'met', 'open', 'excused'])
  })
})
