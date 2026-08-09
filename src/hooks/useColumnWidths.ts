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
 * Clases de una tabla con columnas redimensionables:
 *  - `table-fixed` hace que el ancho del `<th>` mande (con layout `auto` el
 *    navegador lo trata como sugerencia y el arrastre se siente "elástico").
 *  - `w-max min-w-full` deja que la tabla crezca más allá del contenedor
 *    —scroll horizontal, que es justo lo que se busca— sin encogerse cuando
 *    las columnas suman menos que el ancho disponible.
 *  - el truncado por celda evita que el texto se desborde a la columna vecina.
 */
export const RESIZABLE_TABLE_CLASS =
  'table-fixed w-max min-w-full [&_td]:overflow-hidden [&_td]:text-ellipsis'

/**
 * Celda de datos de la columna fija de acciones (par del `sticky` de
 * `ResizableHead`). `bg-inherit` en vez de un color fijo para heredar el fondo
 * de SU fila: así respeta el resaltado por stock del inventario y el hover, en
 * lugar de pintar un parche opaco encima.
 */
export const STICKY_ACTIONS_CELL = 'sticky right-0 z-10 bg-inherit border-l'

/**
 * Anchos de columna redimensionables por tabla (issue #55).
 *
 * SSR-safe igual que `useVisibleColumns`: hasta el primer frame pintado
 * (`useMounted`) reporta el ancho por defecto, para coincidir con el HTML del
 * server y no romper la hidratación al rehidratar localStorage.
 *
 * El clamp inferior vive aquí (no en el store) para que cualquier entrada
 * —arrastre, teclado o un valor viejo en localStorage— quede siempre acotada.
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
