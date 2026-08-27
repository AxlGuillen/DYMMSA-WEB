'use client'

import { useCallback } from 'react'
import { useColumnWidthStore } from '@/stores/columnWidthStore'
import { useMounted } from '@/hooks/useMounted'
import type { TableColumn } from '@/hooks/useVisibleColumns'

/** Piso duro del arrastre: por debajo la columna deja de ser usable. */
export const MIN_COLUMN_WIDTH = 60
/** Ancho cuando la columna no declara `width` propio. */
export const DEFAULT_COLUMN_WIDTH = 160

/**
 * Clases de tabla redimensionable: table-fixed (el <th> manda, sin arrastre
 * "elástico") + w-max min-w-full (crece con scroll-x sin encogerse).
 */
export const RESIZABLE_TABLE_CLASS =
  'table-fixed w-max min-w-full [&_td]:overflow-hidden [&_td]:text-ellipsis'

/** Celda de la columna fija de acciones: bg-inherit hereda el fondo de SU fila (resaltados y hover). */
export const STICKY_ACTIONS_CELL = 'sticky right-0 z-10 bg-inherit border-l'

/**
 * Anchos por tabla (#55). SSR-safe: hasta el primer frame reporta el default
 * (hidratación); el clamp vive aquí para acotar cualquier entrada.
 */
export type ColumnWidths = ReturnType<typeof useColumnWidths>

export function useColumnWidths(tableId: string, columns: readonly TableColumn[]) {
  const stored = useColumnWidthStore((s) => s.widths[tableId])
  const setStoredWidth = useColumnWidthStore((s) => s.setWidth)
  const resetStoredColumn = useColumnWidthStore((s) => s.resetColumn)
  const resetStoredTable = useColumnWidthStore((s) => s.resetTable)
  const mounted = useMounted()

  const defaultWidth = useCallback(
    (id: string) => columns.find((c) => c.id === id)?.width ?? DEFAULT_COLUMN_WIDTH,
    [columns],
  )

  const width = useCallback(
    (id: string) => {
      if (!mounted) return defaultWidth(id)
      const custom = stored?.[id]
      return custom != null ? Math.max(MIN_COLUMN_WIDTH, custom) : defaultWidth(id)
    },
    [mounted, stored, defaultWidth],
  )

  const setWidth = useCallback(
    (id: string, px: number) =>
      setStoredWidth(tableId, id, Math.max(MIN_COLUMN_WIDTH, Math.round(px))),
    [setStoredWidth, tableId],
  )

  return {
    width,
    setWidth,
    isCustom: useCallback((id: string) => stored?.[id] != null, [stored]),
    resetColumn: useCallback(
      (id: string) => resetStoredColumn(tableId, id),
      [resetStoredColumn, tableId],
    ),
    reset: useCallback(() => resetStoredTable(tableId), [resetStoredTable, tableId]),
    hasCustomWidths: mounted && stored != null && Object.keys(stored).length > 0,
  }
}
