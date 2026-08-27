'use client'

import { useCallback, useMemo } from 'react'
import { useColumnStore } from '@/stores/columnStore'
import { useMounted } from '@/hooks/useMounted'

/** Columna del picker (#18). El `id` es API persistida en localStorage — renombrarlo huerfanea la preferencia. */
export interface TableColumn {
  id: string
  /** Etiqueta en español que se muestra en el picker. */
  label: string
  /** false = siempre visible y fuera del picker (acciones, drag, identificador). */
  hideable?: boolean
  /**
   * Ancho por defecto en px para tablas redimensionables (issue #55). No se
   * persiste: es el valor del que parte el arrastre y al que vuelve el reset.
   */
  width?: number
}

/**
 * Visibilidad por tableId. SSR-safe: hasta el primer frame reporta TODO visible
 * (hidratación). `isVisible` es estable — apto para filas memoizadas.
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
