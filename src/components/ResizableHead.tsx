'use client'

import type { ReactNode } from 'react'
import { TableHead } from '@/components/ui/table'
import { ColumnResizer } from '@/components/ColumnResizer'
import type { ColumnWidths } from '@/hooks/useColumnWidths'
import { cn } from '@/lib/utils'

interface ResizableHeadProps {
  /** Id de columna (el mismo de TableColumn / ColumnPicker). */
  id: string
  label: string
  widths: ColumnWidths
  className?: string
  /**
   * Fija la columna al borde derecho. Se usa en "Acciones": al poder ensanchar
   * columnas la tabla desborda, y sin esto editar/eliminar quedan fuera de
   * pantalla — justo lo contrario de tenerlas a un click.
   */
  sticky?: boolean
  /**
   * Contenido propio del encabezado (p. ej. el botón de ordenamiento de la
   * tabla). Si se omite, se pinta la etiqueta truncada.
   */
  children?: ReactNode
}

/**
 * `<th>` con ancho ajustable por arrastre (issue #55). Compartido por las
 * tablas del dashboard para que la manija y el clamp se comporten igual en
 * todas; la tabla solo aporta el contenido del encabezado.
 */
export function ResizableHead({ id, label, widths, className, sticky, children }: ResizableHeadProps) {
  const width = widths.width(id)

  return (
    <TableHead
      className={cn(
        'relative',
        sticky && 'bg-background sticky right-0 z-20 border-l',
        className,
      )}
      style={{ width }}
    >
      {children ?? <span className="block truncate">{label}</span>}
      <ColumnResizer
        width={width}
        onResize={(next) => widths.setWidth(id, next)}
        onReset={() => widths.resetColumn(id)}
        label={label}
      />
    </TableHead>
  )
}
