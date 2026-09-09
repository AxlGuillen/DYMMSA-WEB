/** WeekGrid (#93): totals, open punches and the edit trace; edit controls only for admins. */

import { describe, test, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './helpers/render'
import { WeekGrid } from '@/components/hours/WeekGrid'
import { buildWeekView } from '@/lib/timesheet'
import type { TimeEntry } from '@/types/database'

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: 'te-' + Math.random().toString(36).slice(2, 6),
    user_id: 'u1',
    work_date: '2026-08-31',
    source_clock_in: '10:06',
    clock_in: '10:06',
    clock_out: '18:27',
    note: null,
    source: 'import',
    edited_by: null,
    edited_at: null,
    original: null,
    created_at: '2026-09-07T00:00:00Z',
    updated_at: '2026-09-07T00:00:00Z',
    ...overrides,
  }
}

const WEEK = buildWeekView(
  [
    entry({ work_date: '2026-08-31' }),
    entry({ work_date: '2026-09-01', clock_in: '09:00', clock_out: '12:00' }),
    entry({ work_date: '2026-09-01', clock_in: '13:00', clock_out: null }),
    entry({
      work_date: '2026-09-02',
      clock_in: '08:00',
      clock_out: '16:30',
      edited_by: 'u-admin',
      edited_at: '2026-09-07T10:00:00Z',
      original: { clock_in: '08:00', clock_out: '16:00', note: null },
    }),
  ],
  '2026-08-31',
)

describe('WeekGrid', () => {
  test('pinta 7 días con total diario y semanal en HH:MM', () => {
    renderWithProviders(<WeekGrid week={WEEK} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    // 08:21 + 03:00 + 08:30 = 19:51; the open punch does not count.
    expect(screen.getByTestId('week-total')).toHaveTextContent('19:51')
    expect(screen.getByText('08:21')).toBeInTheDocument()
  })

  test('marca la salida faltante y avisa que no suma', () => {
    renderWithProviders(<WeekGrid week={WEEK} />)
    expect(screen.getByText('sin salida')).toBeInTheDocument()
    expect(screen.getByText(/1 sin salida \(no suman\)/)).toBeInTheDocument()
  })

  test('muestra el marcador de editado', () => {
    renderWithProviders(<WeekGrid week={WEEK} namesById={{ 'u-admin': 'Diego' }} />)
    expect(screen.getByLabelText('Editado')).toBeInTheDocument()
  })

  test('sin canEdit no hay botones de edición ni de alta', () => {
    renderWithProviders(<WeekGrid week={WEEK} onEdit={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.queryByLabelText('Editar checada')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /checada/ })).not.toBeInTheDocument()
  })

  test('con canEdit los botones llaman a onEdit/onAdd', async () => {
    const onEdit = vi.fn()
    const onAdd = vi.fn()
    const user = (await import('@testing-library/user-event')).default.setup()
    renderWithProviders(<WeekGrid week={WEEK} canEdit onEdit={onEdit} onAdd={onAdd} />)
    await user.click(screen.getAllByLabelText('Editar checada')[0])
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ work_date: '2026-08-31' }))
    const addButtons = screen.getAllByRole('button', { name: /^checada$/ })
    expect(addButtons).toHaveLength(7)
    await user.click(addButtons[6])
    expect(onAdd).toHaveBeenCalledWith('2026-09-06')
  })

  test('sin datos muestra el esqueleto', () => {
    const { container } = renderWithProviders(<WeekGrid week={undefined} isLoading />)
    expect(container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThan(0)
  })
})
