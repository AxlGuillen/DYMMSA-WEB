'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Library, Plus, ArrowUpDown, ArrowUp, ArrowDown } from '@/components/icons'
import { useDeleteCatalogItem } from '@/hooks/useUrreaCatalog'
import { useVisibleColumns, type TableColumn } from '@/hooks/useVisibleColumns'
import { useColumnWidths, RESIZABLE_TABLE_CLASS, STICKY_ACTIONS_CELL, type ColumnWidths } from '@/hooks/useColumnWidths'
import { ResizableHead } from '@/components/ResizableHead'
import { RowActions } from '@/components/RowActions'
import type { CatalogSortField, SortDir } from '@/hooks/useUrreaCatalog'
import { toast } from 'sonner'
import { formatRelative, formatAbsolute } from '@/lib/format'
import type { UrreaCatalogItem } from '@/types/database'

interface CatalogTableProps {
  items: UrreaCatalogItem[]
  isLoading: boolean
  onEdit: (item: UrreaCatalogItem) => void
  onAdd?: () => void
  sortField: CatalogSortField
  sortDir: SortDir
  onSort: (field: CatalogSortField) => void
}

// Columnas del catálogo URREA (issue #18). Código y acciones son fijas.
export const CATALOG_COLUMNS: readonly TableColumn[] = [
  { id: 'code', label: 'Código', hideable: false, width: 150 },
  { id: 'brand', label: 'Marca', width: 110 },
  { id: 'description', label: 'Descripción', width: 340 },
  { id: 'std', label: 'STD', width: 90 },
  { id: 'updated_at', label: 'Última actualización', width: 170 },
  { id: 'actions', label: 'Acciones', hideable: false, width: 100 },
]

function SortHeader({
  label,
  field,
  active,
  dir,
  onSort,
  widths,
  className,
}: {
  label: string
  field: CatalogSortField
  active: boolean
  dir: SortDir
  onSort: (f: CatalogSortField) => void
  widths: ColumnWidths
  className?: string
}) {
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  // `field` coincide con el id de columna del picker: sirve de llave del ancho.
  return (
    <ResizableHead id={field} label={label} widths={widths} className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex max-w-full items-center gap-1.5 hover:text-foreground transition-colors font-medium"
      >
        <span className="truncate">{label}</span>
        <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-foreground' : 'text-muted-foreground/50'}`} />
      </button>
    </ResizableHead>
  )
}

export function CatalogTable({ items, isLoading, onEdit, onAdd, sortField, sortDir, onSort }: CatalogTableProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const deleteItem = useDeleteCatalogItem()
  const cols = useVisibleColumns('urrea-catalog', CATALOG_COLUMNS)
  const widths = useColumnWidths('urrea-catalog', CATALOG_COLUMNS)

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteItem.mutateAsync(deleteId)
      toast.success('Producto eliminado del catálogo')
    } catch {
      toast.error('Error al eliminar producto')
    } finally {
      setDeleteId(null)
    }
  }

  const tableHeaders = (
    <TableHeader>
      <TableRow>
        <SortHeader label="Código" field="code" active={sortField === 'code'} dir={sortDir} onSort={onSort} widths={widths} />
        {cols.isVisible('brand') && (
          <SortHeader label="Marca" field="brand" active={sortField === 'brand'} dir={sortDir} onSort={onSort} widths={widths} />
        )}
        {cols.isVisible('description') && (
          <SortHeader label="Descripción" field="description" active={sortField === 'description'} dir={sortDir} onSort={onSort} widths={widths} />
        )}
        {cols.isVisible('std') && (
          <SortHeader label="STD" field="std" active={sortField === 'std'} dir={sortDir} onSort={onSort} widths={widths} />
        )}
        {cols.isVisible('updated_at') && <ResizableHead id="updated_at" label="Última actualización" widths={widths} />}
        <ResizableHead id="actions" label="Acciones" widths={widths} sticky />
      </TableRow>
    </TableHeader>
  )

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table className={RESIZABLE_TABLE_CLASS}>
          {tableHeaders}
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                {cols.isVisible('brand') && <TableCell><Skeleton className="h-4 w-16" /></TableCell>}
                {cols.isVisible('description') && <TableCell><Skeleton className="h-4 w-48" /></TableCell>}
                {cols.isVisible('std') && <TableCell><Skeleton className="h-4 w-8" /></TableCell>}
                {cols.isVisible('updated_at') && <TableCell><Skeleton className="h-4 w-28" /></TableCell>}
                <TableCell><Skeleton className="size-8 rounded-md" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center rounded-md border">
        <Library className="size-12 text-muted-foreground/40 mb-4" />
        <p className="font-medium text-muted-foreground">No hay productos en el catálogo</p>
        <p className="text-sm text-muted-foreground/70 mt-1">
          Agrega productos manualmente o importa desde Excel.
        </p>
        {onAdd && (
          <Button className="mt-4" onClick={onAdd}>
            <Plus className="mr-2 size-4" />
            Agregar Producto
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table className={RESIZABLE_TABLE_CLASS}>
          {tableHeaders}
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className="bg-background">
                <TableCell className="font-mono text-sm">{item.code}</TableCell>
                {cols.isVisible('brand') && (
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">{item.brand}</Badge>
                  </TableCell>
                )}
                {cols.isVisible('description') && (
                  <TableCell className="max-w-md">
                    {item.description || <span className="text-muted-foreground italic text-xs">Sin descripción</span>}
                  </TableCell>
                )}
                {cols.isVisible('std') && <TableCell className="tabular-nums">{item.std}</TableCell>}
                {cols.isVisible('updated_at') && (
                  <TableCell className="text-muted-foreground text-sm" title={formatAbsolute(item.updated_at)}>
                    {formatRelative(item.updated_at)}
                  </TableCell>
                )}
                <TableCell className={STICKY_ACTIONS_CELL}>
                  <RowActions
                    what={item.code}
                    onEdit={() => onEdit(item)}
                    onDelete={() => setDeleteId(item.id)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar del catálogo</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El producto será eliminado del catálogo URREA.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
