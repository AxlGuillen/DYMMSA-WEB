/** Selectable date format (#92): picker writes, hook reads, both persist in `dymmsa-date-format`. */

import { describe, test, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import { DateFormatPicker } from '@/components/finance/DateFormatPicker'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useDateFormatStore } from '@/stores/dateFormatStore'

function Probe() {
  const fmtDay = useDateFormat()
  return <span data-testid="out">{fmtDay('2026-09-15')}</span>
}

describe('DateFormatPicker + useDateFormat', () => {
  beforeEach(() => resetStores())

  test('arranca en el formato largo y cambia lo que el hook devuelve', async () => {
    const user = userEvent.setup()
    renderWithProviders(<><DateFormatPicker /><Probe /></>)
    expect(screen.getByTestId('out')).toHaveTextContent('15 de septiembre de 2026')

    await user.click(screen.getByRole('combobox', { name: 'Formato de fecha' }))
    await user.click(await screen.findByRole('option', { name: '15-09-2026' }))
    expect(screen.getByTestId('out')).toHaveTextContent('15-09-2026')
  })

  test('la elección queda persistida bajo dymmsa-date-format', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DateFormatPicker />)
    await user.click(screen.getByRole('combobox', { name: 'Formato de fecha' }))
    await user.click(await screen.findByRole('option', { name: '2026-09-15' }))

    expect(useDateFormatStore.getState().dateFormat).toBe('yyyy-mm-dd')
    const raw = localStorage.getItem('dymmsa-date-format')
    expect(raw && JSON.parse(raw).state.dateFormat).toBe('yyyy-mm-dd')
  })

  test('un formato guardado que ya no existe cae al default en vez de romper', () => {
    // A retired format must not leave the table dateless for whoever had it stored.
    useDateFormatStore.setState({ dateFormat: 'retirado' as never })
    renderWithProviders(<Probe />)
    expect(screen.getByTestId('out')).toHaveTextContent('15 de septiembre de 2026')
  })
})
