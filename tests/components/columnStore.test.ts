/**
 * Store de columnas visibles (issue #18). Solo se persisten las OCULTAS:
 * default = todo visible, columnas nuevas aparecen solas.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { useColumnStore } from '@/stores/columnStore'
import { resetStores } from './helpers/stores'

describe('columnStore', () => {
  beforeEach(() => {
    resetStores()
  })

  test('toggle oculta y vuelve a mostrar', () => {
    const { toggleColumn } = useColumnStore.getState()

    toggleColumn('orders-list', 'brand')
    expect(useColumnStore.getState().hidden['orders-list']).toEqual(['brand'])

    toggleColumn('orders-list', 'brand')
    expect(useColumnStore.getState().hidden['orders-list']).toEqual([])
  })

  test('aislamiento por tabla: ocultar en una no afecta otra', () => {
    const { toggleColumn } = useColumnStore.getState()

    toggleColumn('orders-list', 'total')
    toggleColumn('quotations-list', 'customer')

    const { hidden } = useColumnStore.getState()
    expect(hidden['orders-list']).toEqual(['total'])
    expect(hidden['quotations-list']).toEqual(['customer'])
  })

  test('resetTable borra solo la entrada de esa tabla (sin dejar [])', () => {
    const { toggleColumn, resetTable } = useColumnStore.getState()
    toggleColumn('orders-list', 'total')
    toggleColumn('quotations-list', 'customer')

    resetTable('orders-list')

    const { hidden } = useColumnStore.getState()
    expect('orders-list' in hidden).toBe(false)
    expect(hidden['quotations-list']).toEqual(['customer'])
  })

  test('persiste en localStorage bajo dymmsa-columns', () => {
    useColumnStore.getState().toggleColumn('inventory', 'location')

    const raw = localStorage.getItem('dymmsa-columns')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.state.hidden).toEqual({ inventory: ['location'] })
  })
})
