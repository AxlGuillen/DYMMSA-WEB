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
import { Package, Plus, ArrowUpDown, ArrowUp, ArrowDown } from '@/components/icons'
import { useDeleteInventoryItem } from '@/hooks/useInventory'
import { useVisibleColumns, type TableColumn } from '@/hooks/useVisibleColumns'
import { useColumnWidths, RESIZABLE_TABLE_CLASS, STICKY_ACTIONS_CELL } from '@/hooks/useColumnWidths'
import { ResizableHead } from '@/components/ResizableHead'
import { RowActions } from '@/components/RowActions'
import { toast } from 'sonner'
import { formatRelative, formatAbsolute } from '@/lib/format'
import type { StoreInventory } from '@/types/database'
import type { QuantitySort } from '@/hooks/useInventory'

// Columnas del inventario (issue #18). Código y acciones son fijas.
export const INVENTORY_COLUMNS: readonly TableColumn[] = [
  { id: 'model_code', label: 'Código Modelo', hideable: false, width: 220 },
  { id: 'quantity', label: 'Cantidad', width: 160 },
  { id: 'location', label: 'Ubicación', width: 150 },
  { id: 'updated_at', label: 'Última Actualización', width: 200 },
  { id: 'actions', label: 'Acciones', hideable: false, width: 100 },
]

interface InventoryTableProps {
  items: StoreInventory[]
  isLoading: boolean
  onEdit: (item: StoreInventory) => void
  onAdd?: () => void
  quantitySort?: QuantitySort
  onSortQuantity?: () => void
}

export function InventoryTable({ items, isLoading, onEdit, onAdd, quantitySort, onSortQuantity }: InventoryTableProps) {
  const SortIcon = quantitySort === 'desc' ? ArrowDown : quantitySort === 'asc' ? ArrowUp : ArrowUpDown
  const cols = useVisibleColumns('inventory', INVENTORY_COLUMNS)
  const widths = useColumnWidths('inventory', INVENTORY_COLUMNS)

  const tableHeaders = (
    <TableHeader>
      <TableRow>
        <ResizableHead id="model_code" label="Código Modelo" widths={widths} />
        {cols.isVisible('quantity') && (
          <ResizableHead id="quantity" label="Cantidad" widths={widths}>
            <button type="button"
              onClick={onSortQuantity}
              className="flex max-w-full items-center gap-1.5 hover:text-foreground transition-colors font-medium"
            >
              <span className="truncate">Cantidad</span>
              <SortIcon className={`h-3.5 w-3.5 shrink-0 ${quantitySort ? 'text-foreground' : 'text-muted-foreground/50'}`} />
            </button>
          </ResizableHead>
        )}
        {cols.isVisible('location') && <ResizableHead id="location" label="Ubicación" widths={widths} />}
        {cols.isVisible('updated_at') && <ResizableHead id="updated_at" label="Última Actualización" widths={widths} />}
        <ResizableHead id="actions" label="Acciones" widths={widths} sticky />
      </TableRow>
    </TableHeader>
  )
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const deleteItem = useDeleteInventoryItem()

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteItem.mutateAsync(deleteId)
      toast.success('Producto eliminado del inventario')
    } catch {
      toast.error('Error al eliminar producto')
    } finally {
      setDeleteId(null)
    }
  }

  const getQuantityBadge = (quantity: number) => {
    if (quantity === 0) {
      return <Badge variant="destructive">Sin stock</Badge>
    }
    if (quantity <= 5) {
      return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">Bajo: {quantity}</Badge>
    }
    return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">{quantity}</Badge>
  }

  // Los tonos van OPACOS vía color-mix (mismo color resultante que un `/50` o
  // `/20` sobre el fondo, pero sin canal alfa): la columna fija de acciones
  // hereda este color con `bg-inherit`, y con transparencia se alcanzaría a ver
  // el contenido de las columnas que pasan por debajo al hacer scroll lateral.
  const getRowClass = (quantity: number) => {
    if (quantity === 0)
      return 'bg-[color-mix(in_oklab,var(--color-red-50)_50%,var(--background))] dark:bg-[color-mix(in_oklab,var(--color-red-950)_20%,var(--background))]'
    if (quantity <= 5)
      return 'bg-[color-mix(in_oklab,var(--color-yellow-50)_50%,var(--background))] dark:bg-[color-mix(in_oklab,var(--color-yellow-950)_20%,var(--background))]'
    return 'bg-background'
  }

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table className={RESIZABLE_TABLE_CLASS}>
          {tableHeaders}
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                {cols.isVisible('quantity') && <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>}
                {cols.isVisible('location') && <TableCell><Skeleton className="h-4 w-16" /></TableCell>}
                {cols.isVisible('updated_at') && <TableCell><Skeleton className="h-4 w-32" /></TableCell>}
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
        <Package className="size-12 text-muted-foreground/40 mb-4" />
        <p className="font-medium text-muted-foreground">No hay productos en el inventario</p>
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
              <TableRow key={item.id} className={`hover:bg-muted ${getRowClass(item.quantity)}`}>
                <TableCell className="font-mono text-sm">{item.model_code}</TableCell>
                {cols.isVisible('quantity') && (
                  <TableCell>{getQuantityBadge(item.quantity)}</TableCell>
                )}
                {cols.isVisible('location') && (
                  <TableCell className="font-mono text-sm">
                    {item.quantity > 0 && item.location
                      ? item.location
                      : <span className="text-muted-foreground">{'—'}</span>}
                  </TableCell>
                )}
                {cols.isVisible('updated_at') && (
                  <TableCell
                    className="text-muted-foreground text-sm"
                    title={formatAbsolute(item.updated_at)}
                  >
                    {formatRelative(item.updated_at)}
                  </TableCell>
                )}
                <TableCell className={STICKY_ACTIONS_CELL}>
                  <RowActions
                    what={item.model_code}
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
            <AlertDialogTitle>Eliminar del inventario</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El producto será eliminado del inventario.
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
