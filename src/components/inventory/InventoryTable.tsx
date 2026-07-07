'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { MoreHorizontal, Pencil, Trash2, Package, Plus, ArrowUpDown, ArrowUp, ArrowDown } from '@/components/icons'
import { useDeleteInventoryItem } from '@/hooks/useInventory'
import { toast } from 'sonner'
import { formatRelative, formatAbsolute } from '@/lib/format'
import type { StoreInventory } from '@/types/database'
import type { QuantitySort } from '@/hooks/useInventory'

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

  const tableHeaders = (
    <TableHeader>
      <TableRow>
        <TableHead className="w-[220px]">Código Modelo</TableHead>
        <TableHead className="w-[160px]">
          <button type="button"
            onClick={onSortQuantity}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors font-medium"
          >
            Cantidad
            <SortIcon className={`h-3.5 w-3.5 ${quantitySort ? 'text-foreground' : 'text-muted-foreground/50'}`} />
          </button>
        </TableHead>
        <TableHead className="w-[140px]">Ubicación</TableHead>
        <TableHead>Última Actualización</TableHead>
        <TableHead className="w-[80px]">Acciones</TableHead>
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

  const getRowClass = (quantity: number) => {
    if (quantity === 0)  return 'bg-red-50/50 dark:bg-red-950/20'
    if (quantity <= 5)   return 'bg-yellow-50/50 dark:bg-yellow-950/20'
    return ''
  }

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table>
          {tableHeaders}
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
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
        <Table>
          {tableHeaders}
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className={getRowClass(item.quantity)}>
                <TableCell className="font-mono text-sm">{item.model_code}</TableCell>
                <TableCell>{getQuantityBadge(item.quantity)}</TableCell>
                <TableCell className="font-mono text-sm">
                  {item.quantity > 0 && item.location
                    ? item.location
                    : <span className="text-muted-foreground">{'—'}</span>}
                </TableCell>
                <TableCell
                  className="text-muted-foreground text-sm"
                  title={formatAbsolute(item.updated_at)}
                >
                  {formatRelative(item.updated_at)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(item)}>
                        <Pencil className="mr-2 size-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setDeleteId(item.id)}
                      >
                        <Trash2 className="mr-2 size-4" />
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
