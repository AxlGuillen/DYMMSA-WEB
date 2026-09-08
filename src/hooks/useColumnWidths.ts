'use client'

import { useCallback } from 'react'
import { useColumnWidthStore } from '@/stores/columnWidthStore'
import { useMounted } from '@/hooks/useMounted'
import type { TableColumn } from '@/hooks/useVisibleColumns'

/** Drag floor: below this the column stops being usable. */
export const MIN_COLUMN_WIDTH = 60
/** Fallback when the column declares no `width`. */
export const DEFAULT_COLUMN_WIDTH = 160

/** table-fixed so the <th> rules (no elastic drag); w-max min-w-full grows with scroll-x. */
export const RESIZABLE_TABLE_CLASS =
  'table-fixed w-max min-w-full [&_td]:overflow-hidden [&_td]:text-ellipsis'

/** bg-inherit so the sticky cell keeps ITS row background (highlight, hover). */
export const STICKY_ACTIONS_CELL = 'sticky right-0 z-10 bg-inherit border-l'

/** Per-table widths (#55). SSR-safe: reports the default until hydrated. */
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
