'use client'

import { useCallback, useMemo } from 'react'
import { useColumnStore } from '@/stores/columnStore'
import { useMounted } from '@/hooks/useMounted'

/**
 * Definición de una columna de tabla para el selector de columnas (issue #18).
 *
 * `id` es un slug estable en inglés y es **API persistida** (se guarda en
 * localStorage): renombrarlo huerfanea la preferencia — la columna vuelve a
 * visible (default seguro), pero evítalo.
 */
export interface TableColumn {
  id: string
  /** Etiqueta en español que se muestra en el picker. */
  label: string
  /** false = siempre visible y fuera del picker (acciones, drag, identificador). */
  hideable?: boolean
}

/**
 * Visibilidad de columnas de una tabla, persistida por `tableId`.
 *
 * SSR-safe: hasta el primer frame pintado (`useMounted`) reporta TODO visible
 * para coincidir con el HTML del server — mismo precedente que el sidebar
 * (evita el mismatch de hidratación al rehidratar el store de localStorage).
 *
 * `isVisible` tiene identidad estable entre renders (useCallback sobre el
 * array del store, que es referencialmente estable hasta el siguiente toggle)
 * — apto para bajarlo a filas memoizadas (DnD) sin romper su memo.
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

  // Solo cuenta ocultas que EXISTEN en las defs actuales (ignora huérfanas de
  // ids renombrados y de columnas condicionales ausentes) — el badge nunca miente.
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
