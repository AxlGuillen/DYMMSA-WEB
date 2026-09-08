/** ColumnPicker (#18): hideable columns only, toggle hits the store, badge counts the hidden ones. */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import { ColumnPicker } from '@/components/ColumnPicker'
import { useColumnStore } from '@/stores/columnStore'
import type { TableColumn } from '@/hooks/useVisibleColumns'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const COLUMNS: readonly TableColumn[] = [
  { id: 'etm', label: 'ETM', hideable: false },
  { id: 'brand', label: 'Marca' },
  { id: 'price', label: 'Precio' },
  { id: 'actions', label: 'Acciones', hideable: false },
]

describe('ColumnPicker', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  test('solo lista las columnas ocultables (las fijas no aparecen)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ColumnPicker tableId="t1" columns={COLUMNS} />)

    await user.click(screen.getByRole('button', { name: /columnas/i }))

    expect(screen.getByRole('menuitemcheckbox', { name: 'Marca' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Precio' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'ETM' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Acciones' })).not.toBeInTheDocument()
  })

  test('togglear una columna la oculta en el store y el menú sigue abierto', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ColumnPicker tableId="t1" columns={COLUMNS} />)

    await user.click(screen.getByRole('button', { name: /columnas/i }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Marca' }))

    expect(useColumnStore.getState().hidden['t1']).toEqual(['brand'])
    // onSelect preventDefault: the menu stayed open
    expect(screen.getByRole('menuitemcheckbox', { name: 'Precio' })).toBeInTheDocument()
  })

  test('badge con el conteo de ocultas y restablecer lo limpia', async () => {
    const user = userEvent.setup()
    useColumnStore.setState({ hidden: { t1: ['brand', 'price'] } })
    renderWithProviders(<ColumnPicker tableId="t1" columns={COLUMNS} />)

    // Badge shows 2 (after the useMounted frame)
    expect(await screen.findByText('2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /columnas/i }))
    await user.click(screen.getByRole('menuitem', { name: /restablecer columnas/i }))

    expect('t1' in useColumnStore.getState().hidden).toBe(false)
  })

  test('ocultas huérfanas (ids que ya no existen) no inflan el badge', async () => {
    useColumnStore.setState({ hidden: { t1: ['columna-vieja'] } })
    renderWithProviders(<ColumnPicker tableId="t1" columns={COLUMNS} />)

    // One frame for useMounted; the badge must not appear
    await new Promise((r) => requestAnimationFrame(r))
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })
})
