'use client'

import { useCallback, useMemo } from 'react'
import { useColumnStore } from '@/stores/columnStore'
import { useMounted } from '@/hooks/useMounted'

/** Picker column (#18). `id` is persisted in localStorage: renaming it orphans the preference. */
export interface TableColumn {
  id: string
  label: string
  /** false = always visible and out of the picker. */
  hideable?: boolean
  /** Default px width (#55). Not persisted: reset returns here. */
  width?: number
}

/**
 * SSR-safe: reports everything visible until hydrated.
 * `isVisible` is stable, so memoized rows keep working.
 */
export function useVisibleColumns(tableId: string, columns: readonly TableColumn[]) {
  const hiddenIds = useColumnStore((s) => s.hidden[tableId])
  const toggleColumn = useColumnStore((s) => s.toggleColumn)
  const resetTable = useColumnStore((s) => s.resetTable)
  const mounted = useMounted()

  const isVisible = useCallback(
    (id: string) => {
      if (!mounted) return true
      const column = columns.find((c) => c.id === id)
      if (column && column.hideable === false) return true
      return !(hiddenIds ?? []).includes(id)
    },
    [mounted, hiddenIds, columns],
  )

  const visibleColumns = useMemo(
    () => columns.filter((c) => isVisible(c.id)),
    [columns, isVisible],
  )

  // Only counts hidden ids that still exist in the defs, so the badge never lies.
  const hiddenCount = useMemo(() => {
    if (!mounted) return 0
    return (hiddenIds ?? []).filter((id) =>
      columns.some((c) => c.id === id && c.hideable !== false),
    ).length
  }, [mounted, hiddenIds, columns])

  return {
    isVisible,
    visibleColumns,
    visibleCount: visibleColumns.length,
    hiddenCount,
    toggle: useCallback((id: string) => toggleColumn(tableId, id), [toggleColumn, tableId]),
    reset: useCallback(() => resetTable(tableId), [resetTable, tableId]),
  }
}
