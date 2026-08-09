/**
 * Anchos de columna redimensionables (issue #55). Solo se persisten los anchos
 * que el usuario ARRASTRÓ: el resto sale del default declarado en la columna,
 * así que cambiar un default en código se refleja para quien no lo tocó.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useColumnWidthStore } from '@/stores/columnWidthStore'
import {
  useColumnWidths,
  MIN_COLUMN_WIDTH,
  DEFAULT_COLUMN_WIDTH,
} from '@/hooks/useColumnWidths'
import type { TableColumn } from '@/hooks/useVisibleColumns'
import { resetStores } from './helpers/stores'

const COLUMNS: readonly TableColumn[] = [
  { id: 'etm', label: 'ETM', width: 140 },
  { id: 'description', label: 'Descripcion', width: 280 },
  { id: 'sin_width', label: 'Sin ancho declarado' },
]

/**
 * `useMounted` marca montado dentro de un requestAnimationFrame (para no
 * animar la rehidratación), y act() no vacía rAF en jsdom: hay que esperarlo
 * o el hook responde con los defaults de SSR — mismo patrón que ColumnPicker.
 */
const render = async () => {
  const hook = renderHook(() => useColumnWidths('products', COLUMNS))
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  return hook
}

describe('columnWidthStore', () => {
  beforeEach(() => resetStores())

  test('setWidth guarda por tabla y columna', () => {
    useColumnWidthStore.getState().setWidth('products', 'etm', 200)
    expect(useColumnWidthStore.getState().widths.products).toEqual({ etm: 200 })
  })

  test('aislamiento por tabla', () => {
    const { setWidth } = useColumnWidthStore.getState()
    setWidth('products', 'etm', 200)
    setWidth('inventory', 'model_code', 300)

    const { widths } = useColumnWidthStore.getState()
    expect(widths.products).toEqual({ etm: 200 })
    expect(widths.inventory).toEqual({ model_code: 300 })
  })

  test('resetColumn borra la tabla entera al quedar sin anchos (no deja {})', () => {
    const { setWidth, resetColumn } = useColumnWidthStore.getState()
    setWidth('products', 'etm', 200)
    setWidth('products', 'description', 400)

    resetColumn('products', 'etm')
    expect(useColumnWidthStore.getState().widths.products).toEqual({ description: 400 })

    resetColumn('products', 'description')
    expect('products' in useColumnWidthStore.getState().widths).toBe(false)
  })

  test('resetTable no toca otras tablas', () => {
    const { setWidth, resetTable } = useColumnWidthStore.getState()
    setWidth('products', 'etm', 200)
    setWidth('inventory', 'model_code', 300)

    resetTable('products')
    const { widths } = useColumnWidthStore.getState()
    expect('products' in widths).toBe(false)
    expect(widths.inventory).toEqual({ model_code: 300 })
  })
})

describe('useColumnWidths', () => {
  beforeEach(() => resetStores())

  test('sin ancho custom usa el default de la columna', async () => {
    const { result } = await render()
    expect(result.current.width('etm')).toBe(140)
    expect(result.current.isCustom('etm')).toBe(false)
  })

  test('columna sin `width` declarado cae al default global', async () => {
    const { result } = await render()
    expect(result.current.width('sin_width')).toBe(DEFAULT_COLUMN_WIDTH)
  })

  test('setWidth se refleja y marca la columna como custom', async () => {
    const { result } = await render()
    act(() => result.current.setWidth('etm', 250))
    expect(result.current.width('etm')).toBe(250)
    expect(result.current.isCustom('etm')).toBe(true)
  })

  test('clamp: por debajo del mínimo se acota (arrastre agresivo)', async () => {
    const { result } = await render()
    act(() => result.current.setWidth('etm', 10))
    expect(result.current.width('etm')).toBe(MIN_COLUMN_WIDTH)
  })

  test('clamp también al LEER: un valor viejo bajo en localStorage queda acotado', async () => {
    useColumnWidthStore.setState({ widths: { products: { etm: 4 } } })
    const { result } = await render()
    expect(result.current.width('etm')).toBe(MIN_COLUMN_WIDTH)
  })

  test('los px se redondean (el arrastre da fracciones)', async () => {
    const { result } = await render()
    act(() => result.current.setWidth('etm', 187.6))
    expect(result.current.width('etm')).toBe(188)
  })

  test('resetColumn devuelve al default de la columna', async () => {
    const { result } = await render()
    act(() => result.current.setWidth('etm', 250))
    act(() => result.current.resetColumn('etm'))
    expect(result.current.width('etm')).toBe(140)
    expect(result.current.isCustom('etm')).toBe(false)
  })

  test('hasCustomWidths refleja si la tabla fue tocada', async () => {
    const { result } = await render()
    expect(result.current.hasCustomWidths).toBe(false)
    act(() => result.current.setWidth('description', 400))
    expect(result.current.hasCustomWidths).toBe(true)
  })
})
