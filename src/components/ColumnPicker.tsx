'use client'

import { ListFilter, RotateCcw } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useVisibleColumns, type TableColumn } from '@/hooks/useVisibleColumns'
import { cn } from '@/lib/utils'

interface ColumnPickerProps {
  tableId: string
  columns: readonly TableColumn[]
  className?: string
}

/**
 * Selector "Columnas" por tabla (issue #18): checkbox por columna ocultable
 * + restablecer. Comparte estado con la tabla vía useVisibleColumns (mismo
 * tableId) — sin prop threading.
 */
export function ColumnPicker({ tableId, columns, className }: ColumnPickerProps) {
  const cols = useVisibleColumns(tableId, columns)
  const hideable = columns.filter((c) => c.hideable !== false)

  if (hideable.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn('gap-1.5', className)}>
          <ListFilter className="size-4" />
          Columnas
          {cols.hiddenCount > 0 && (
            <Badge variant="secondary" className="px-1.5 text-xs">
              {cols.hiddenCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Mostrar columnas</DropdownMenuLabel>
        {hideable.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={cols.isVisible(column.id)}
            onCheckedChange={() => cols.toggle(column.id)}
            // El menú se queda abierto para togglear varias columnas de corrido.
            onSelect={(e) => e.preventDefault()}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={cols.reset} disabled={cols.hiddenCount === 0}>
          <RotateCcw className="mr-2 size-4" />
          Restablecer columnas
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
