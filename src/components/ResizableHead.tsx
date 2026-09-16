'use client'

import type { ReactNode } from 'react'
import { TableHead } from '@/components/ui/table'
import { ColumnResizer } from '@/components/ColumnResizer'
import type { ColumnWidths } from '@/hooks/useColumnWidths'
import { cn } from '@/lib/utils'

interface ResizableHeadProps {
  /** Column id, the same one used by TableColumn / ColumnPicker. */
  id: string
  label: string
  widths: ColumnWidths
  className?: string
  /** Pins the column right (Acciones) so its buttons stay on screen when widening. */
  sticky?: boolean
  /** Custom header content; without it, the truncated label is rendered. */
  children?: ReactNode
}

/** Resizable <th> (#55), shared so handle and clamp match across every table. */
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
