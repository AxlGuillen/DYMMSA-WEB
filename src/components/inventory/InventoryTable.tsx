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
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useDeleteInventoryItem } from '@/hooks/useInventory'
import { toast } from 'sonner'
import type { StoreInventory } from '@/types/database'

interface InventoryTableProps {
  items: StoreInventory[]
  isLoading: boolean
  onEdit: (item: StoreInventory) => void
}

export function InventoryTable({ items, isLoading, onEdit }: InventoryTableProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const deleteItem = useDeleteInventoryItem()

  const handleDelete = async () => {
    if (!deleteId) return

    try {
      await deleteItem.mutateAsync(deleteId)
      toast.success('Producto eliminado del inventario')
    } catch (error) {
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
      return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">Bajo: {quantity}</Badge>
    }
    return <Badge variant="secondary" className="bg-green-100 text-green-800">{quantity}</Badge>
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">No hay productos en el inventario</p>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Codigo Modelo</TableHead>
              <TableHead className="w-[150px]">Cantidad</TableHead>
              <TableHead>Ultima Actualizacion</TableHead>
              <TableHead className="w-[80px]">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-sm">{item.model_code}</TableCell>
                <TableCell>{getQuantityBadge(item.quantity)}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {new Date(item.updated_at).toLocaleString('es-MX')}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(item)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setDeleteId(item.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
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
              Esta accion no se puede deshacer. El producto sera eliminado del inventario.
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
